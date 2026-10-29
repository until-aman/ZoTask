// Side-by-side comparison of two stakeholders of the same kind, counted per task like the dashboard.
import { all } from "./db";
import { HOUR, addDays, isoDate } from "./time";
import { geo, rows, Row } from "./queries";
import { User, scopeProps } from "./auth";
import * as M from "./metrics";
import { Rv, dayStart, ground, pct, quant, reviewing, uniq, REVIEW_ST } from "./command";

export type Kind = "property" | "cluster" | "city" | "cbm" | "assignee" | "reviewer";
export const KINDS: [Kind, string][] = [["property", "Properties"], ["cluster", "Clusters"], ["city", "Cities"], ["cbm", "CBMs"], ["assignee", "Assignees"], ["reviewer", "Reviewers"]];
export type Metric = { key: string; label: string; means: string; fmt: "pct" | "n" | "dur"; better: "high" | "low" | null; vals: { v: number | null; ids: number[]; of?: number }[] };
type Focus = { types: { task: string; due: number; onTime: number | null; missed: number; ids: number[] }[]; reasons: { reason: string; ids: number[] }[] };
const MAX = 8;
type Opt = { id: string; label: string; sub?: string };

export function compareData(u: User, sp: Record<string, string | undefined>, now = Date.now()) {
  const kind = (KINDS.find(([k]) => k === sp.kind)?.[0] ?? "property") as Kind;
  const preset = sp.range ?? "14d";
  const R = M.rangeFor(preset, isoDate(now), sp.from, sp.to);
  const scope = scopeProps(u);
  const G = geo().filter((g) => scope.includes(g.id));
  const inScope = `IN (${scope.join(",") || 0})`;

  // Options for each kind, limited to what this user can see.
  const people = (role: string) => all<{ id: number; name: string; op_role: string | null }>(
    `SELECT DISTINCT u.id, u.name, u.op_role FROM users u WHERE u.access_role=? ORDER BY u.name`, role);
  const assignees = all<{ id: number; name: string; op_role: string | null; property: string }>(
    `SELECT u.id, u.name, u.op_role, min(p.name) property FROM instances i JOIN users u ON u.id=i.assignee_id JOIN properties p ON p.id=i.property_id
     WHERE i.property_id ${inScope} GROUP BY u.id ORDER BY u.name`);
  const options: Opt[] =
    kind === "property" ? G.map((g) => ({ id: String(g.id), label: g.property, sub: `${g.cluster}, ${g.city}` })) :
    kind === "cluster" ? [...new Map(G.map((g) => [g.cluster, { id: g.cluster, label: g.cluster, sub: g.city }])).values()] :
    kind === "city" ? [...new Set(G.map((g) => g.city))].map((c) => ({ id: c, label: c })) :
    kind === "cbm" ? people("cbm").map((p) => ({ id: String(p.id), label: p.name })) :
    kind === "assignee" ? assignees.map((p) => ({ id: String(p.id), label: p.name, sub: `${p.op_role ?? ""} · ${p.property}` })) :
    people("reviewer").map((p) => ({ id: String(p.id), label: p.name }));
  // Picked ids come as a comma list; old a/b links still work. Default to the first three.
  const want = (sp.ids ?? [sp.a, sp.b].filter(Boolean).join(",")).split(",").filter(Boolean);
  let picked = [...new Set(want)].map((id) => options.find((o) => o.id === id)).filter((o): o is Opt => !!o).slice(0, MAX);
  if (!want.length) picked = options.slice(0, 3);

  const base = { kind, preset, R, options, picked, max: MAX, kinds: KINDS, now, canEscalate: ["admin", "reviewer", "auditor"].includes(u.access_role) };
  if (picked.length < 2) return { ...base, metrics: [] as Metric[], series: null, tasks: {}, focus: [] as Focus[] };

  const list = rows(`i.task_date BETWEEN ? AND ? AND i.property_id ${inScope}`, R.from, R.to);
  const match = (o: Opt) => (r: Row) =>
    kind === "property" ? String(r.property_id) === o.id : kind === "cluster" ? r.cluster === o.id : kind === "city" ? r.city === o.id :
    kind === "cbm" ? String(r.cbm_id) === o.id : kind === "assignee" ? String(r.assignee_id) === o.id : String(r.reviewer_id) === o.id;
  const revAll = all<Rv>(`SELECT rv.id, rv.instance_id, rv.reviewer_id, u.name reviewer, rv.kind, rv.decision, rv.decided_at, rv.due_at, rv.comment,
      s.submitted_at, s.attempt, i.property_id, t.category, i.reviewer_id i_reviewer
    FROM reviews rv JOIN users u ON u.id=rv.reviewer_id JOIN submissions s ON s.id=rv.submission_id JOIN instances i ON i.id=rv.instance_id JOIN templates t ON t.id=i.template_id
    WHERE rv.decided_at>=? AND i.property_id ${inScope}`, dayStart(R.from) - 7 * 864e5);
  const sentBack = new Map<number, number>(), passed = new Set<number>();
  for (const x of revAll) if (x.kind === "review") {
    if (x.decision === "changes") sentBack.set(x.instance_id, (sentBack.get(x.instance_id) ?? 0) + 1);
    if (x.decision === "pass") passed.add(x.instance_id);
  }
  const inR = (x: { decided_at: number }) => x.decided_at >= dayStart(R.from) && x.decided_at < dayStart(R.to) + 864e5;
  const open = M.loadOpen(scope);
  const tasks = new Map<number, Row>();
  const days: string[] = []; for (let d = R.from; d <= R.to; d = addDays(d, 1)) days.push(d);

  // Fix time per task: first send-back to first resubmission.
  const fixEv = all<{ instance_id: number; type: string; at: number }>(
    `SELECT e.instance_id, e.type, e.at FROM events e JOIN instances i ON i.id=e.instance_id WHERE e.type IN ('changes_requested','resubmitted') AND i.task_date BETWEEN ? AND ? AND i.property_id ${inScope} ORDER BY e.at`, R.from, R.to);
  const fix = new Map<number, number>();
  { const asked = new Map<number, number>();
    for (const e of fixEv) if (e.type === "changes_requested") { if (!asked.has(e.instance_id)) asked.set(e.instance_id, e.at); }
      else if (asked.has(e.instance_id) && !fix.has(e.instance_id)) fix.set(e.instance_id, e.at - asked.get(e.instance_id)!); }
  const flags = all<{ instance_id: number; reason: string }>(`SELECT DISTINCT rv.instance_id, f.reason FROM review_flags f JOIN reviews rv ON rv.id=f.review_id JOIN instances i ON i.id=rv.instance_id
    WHERE rv.kind='review' AND rv.decided_at>=? AND rv.decided_at<? AND i.property_id ${inScope}`, dayStart(R.from), dayStart(R.to) + 864e5);
  const audits = revAll.filter((x) => x.kind === "audit" && inR(x));

  const side = (o: Opt) => {
    const mine = list.filter(match(o));
    for (const r of mine) tasks.set(r.id, r);
    const ids = new Set(mine.map((r) => r.id));
    if (kind !== "reviewer") {
      const g = ground(mine, sentBack, passed, now);
      const overdueNow = open.filter(match(o)).filter((r) => r.status === "notsub");
      for (const r of overdueNow) tasks.set(r.id, r);
      const fixed = mine.filter((r) => fix.has(r.id));
      // Weakest task types and most common send-back reasons point at what to improve.
      const byType = new Map<string, Row[]>(); for (const r of mine) byType.set(r.task, [...(byType.get(r.task) ?? []), r]);
      const types = [...byType].map(([task, l]) => { const x = ground(l, sentBack, passed, now); return { task, due: x.due.length, onTime: pct(x.onTime.length, x.due.length), missed: x.missed.length, ids: x.due }; })
        .filter((t) => t.due >= 2).sort((p, q) => (p.onTime ?? 101) - (q.onTime ?? 101));
      const reasons = [...flags.filter((f) => ids.has(f.instance_id)).reduce((m, f) => m.set(f.reason, [...(m.get(f.reason) ?? []), f.instance_id]), new Map<string, number[]>())]
        .map(([reason, l]) => ({ reason, ids: uniq(l) })).sort((p, q) => q.ids.length - p.ids.length);
      return {
        metrics: {
          due: { v: g.due.length, ids: g.due },
          onTime: { v: pct(g.onTime.length, g.due.length), ids: g.onTime, of: g.due.length },
          fta: { v: pct(g.fta.length, g.decided.length), ids: g.fta, of: g.decided.length },
          missed: { v: pct(g.missed.length, g.due.length), ids: g.missed, of: g.due.length },
          late: { v: pct(g.late.length, g.due.length), ids: g.late, of: g.due.length },
          repeat: { v: pct(g.repeat.length, g.decided.length), ids: g.repeat, of: g.decided.length },
          approved: { v: pct(g.approved.length, g.due.length), ids: g.approved, of: g.due.length },
          overdue: { v: overdueNow.length, ids: overdueNow.map((r) => r.id) },
          fix: { v: quant(fixed.map((r) => fix.get(r.id)!), 0.5), ids: fixed.map((r) => r.id) },
        },
        series: days.map((d) => { const x = ground(mine.filter((r) => r.task_date === d), sentBack, passed, now); return pct(x.onTime.length, x.due.length); }),
        types: types.slice(0, 3), reasons: reasons.slice(0, 3),
      };
    }
    // Reviewers: tasks they reviewed in the period plus their open backlog.
    const rid = Number(o.id);
    const mineRev = revAll.filter((x) => x.reviewer_id === rid && inR(x));
    const backlog = open.filter((r) => r.reviewer_id === rid);
    for (const r of backlog) tasks.set(r.id, r);
    const v = reviewing(mineRev, backlog, now);
    const extra = rows(`i.id IN (${uniq(mineRev.map((x) => x.instance_id)).join(",") || 0})`); for (const r of extra) tasks.set(r.id, r);
    const submitted = mine.filter((r) => r.first_submitted_at).map((r) => r.id);
    const missedRev = mine.filter((r) => REVIEW_ST.includes(r.status) && now - r.status_since > r.review_sla_h * HOUR).map((r) => r.id);
    const passedByMe = new Set(mineRev.filter((x) => x.kind === "review" && x.decision === "pass").map((x) => x.instance_id));
    const audited = uniq(audits.filter((x) => passedByMe.has(x.instance_id)).map((x) => x.instance_id));
    const failed = uniq(audits.filter((x) => passedByMe.has(x.instance_id) && x.decision === "fail").map((x) => x.instance_id));
    const byType = new Map<string, number[]>(); for (const x of mineRev.filter((y) => y.kind === "review")) { const t = tasks.get(x.instance_id)?.task ?? "Task"; byType.set(t, uniq([...(byType.get(t) ?? []), x.instance_id])); }
    const types = [...byType].map(([task, l]) => { const vv = reviewing(mineRev.filter((x) => l.includes(x.instance_id)), [], now); return { task, due: l.length, onTime: pct(vv.inSla.length, vv.reviewed.length), missed: 0, ids: l }; })
      .filter((t) => t.due >= 2).sort((p, q) => (p.onTime ?? 101) - (q.onTime ?? 101));
    return {
      metrics: {
        reviewed: { v: v.reviewed.length, ids: v.reviewed },
        inSla: { v: pct(v.inSla.length, v.reviewed.length), ids: v.inSla, of: v.reviewed.length },
        wait: { v: v.median, ids: v.reviewed },
        missedRev: { v: pct(missedRev.length, submitted.length), ids: missedRev, of: submitted.length },
        over: { v: v.over.length, ids: v.over },
        sentBack: { v: pct(v.sentBack.length, v.reviewed.length), ids: v.sentBack, of: v.reviewed.length },
        reReviewed: { v: v.reReviewed.length, ids: v.reReviewed },
        auditFail: { v: pct(failed.length, audited.length), ids: failed, of: audited.length },
      },
      series: days.map((d) => { const x = reviewing(mineRev.filter((y) => y.decided_at >= dayStart(d) && y.decided_at < dayStart(d) + 864e5), [], now); return pct(x.inSla.length, x.reviewed.length); }),
      types: types.slice(0, 3), reasons: [] as { reason: string; ids: number[] }[],
    };
  };
  const S = picked.map(side);
  const DEF: [string, string, string, Metric["fmt"], Metric["better"]][] = kind === "reviewer" ? [
    ["reviewed", "Tasks reviewed", "Tasks reviewed in the period", "n", null],
    ["inSla", "Reviewed on time", "Reviewed tasks where every review was on time", "pct", "high"],
    ["wait", "Usual review wait", "Typical time a task waited for its review", "dur", "low"],
    ["missedRev", "Missed reviews", "Submitted tasks not reviewed within the limit", "pct", "low"],
    ["over", "Waiting too long now", "Tasks waiting for this reviewer past the limit", "n", "low"],
    ["auditFail", "Failed audit after approval", "Tasks this reviewer approved that then failed audit", "pct", "low"],
    ["sentBack", "Sent back %", "Reviewed tasks sent back for fixes. Not good or bad on its own", "pct", null],
    ["reReviewed", "Re-reviewed tasks", "Tasks reviewed more than once", "n", null],
  ] : [
    ["due", "Deadline passed", "Tasks whose deadline is over in the period", "n", null],
    ["onTime", "Done on time", "Submitted by the deadline ÷ deadline passed", "pct", "high"],
    ["fta", "Approved first time", "Approved at the first review ÷ tasks reviewed", "pct", "high"],
    ["approved", "Approved (any attempt)", "Approved at any attempt ÷ deadline passed", "pct", "high"],
    ["missed", "Missed", "Never submitted ÷ deadline passed", "pct", "low"],
    ["late", "Done late", "Submitted after the deadline ÷ deadline passed", "pct", "low"],
    ["repeat", "Sent back 2+ times", "Tasks sent back twice or more ÷ tasks reviewed", "pct", "low"],
    ["fix", "Usual fix time", "Typical time from send-back to resubmission", "dur", "low"],
    ["overdue", "Overdue, not done now", "Past deadline and still not submitted", "n", "low"],
  ];
  type MV = Metric["vals"][number];
  const metrics: Metric[] = DEF.map(([key, label, means, fmt, better]) => {
    const vals = S.map((x) => (x.metrics as unknown as Record<string, MV>)[key]);
    return { key, label, means, fmt, better, vals };
  });
  const toT = (r: Row) => ({ id: r.id, pid: r.property_id, property: r.property, city: r.city, cluster: r.cluster, task: r.task, tid: r.template_id, category: r.category,
    crit: r.criticality === "high", assignee: r.assignee, reviewer: r.reviewer, cbm: r.cbm, status: r.status, date: r.task_date, start: r.window_start_at, due: r.window_end_at,
    lateUntil: r.late_until_at, sub: r.first_submitted_at, attempt: r.attempt, max: r.attempts_allowed, since: r.status_since, reason: r.last_reason });
  return {
    ...base, metrics, tasks: Object.fromEntries([...tasks].map(([id, r]) => [id, toT(r)])),
    series: { days, lines: S.map((x) => x.series), label: kind === "reviewer" ? "Reviewed on time" : "Done on time" },
    focus: S.map((x) => ({ types: x.types, reasons: x.reasons })),
  };
}
export type CompareData = ReturnType<typeof compareData>;
