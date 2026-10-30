// Operations command center: every number on the dashboard comes from here, with the task ids behind it,
// so each figure can be opened as a list. Every figure counts tasks, each task once.
import { all } from "./db";
import { HOUR, addDays, isoDate } from "./time";
import { geo, rows, Row } from "./queries";
import { User, scopeProps } from "./auth";
import * as M from "./metrics";

export type SP = Record<string, string | undefined>;
/** A task as the dashboard lists it. */
export type T = {
  id: number; pid: number; property: string; city: string; cluster: string; task: string; tid: number; category: string; crit: boolean;
  assignee: string | null; reviewer: string | null; cbm: string | null; status: string; date: string;
  start: number; due: number; lateUntil: number; sub: number | null; attempt: number; max: number; since: number; reason: string | null;
};
/** A figure with the tasks behind it. `of` is the denominator when the figure is a rate. */
export type K = { n: number; of?: number; rate?: number | null; prev?: number | null; ids: number[] };
export type Issue = {
  key: string; id?: number; ids: number[]; cat: "critical" | "ground" | "review" | "repeat" | "exception"; type: string;
  sev: "Critical" | "High" | "Medium" | "Low"; property: string; pid: number; city: string; cluster: string; task: string;
  owner: string; ownerRole: string; status: string; overdue: number | null; rejections: number; comment: string | null;
  ack: { by: string; at: number } | null; esc: { detail: string; by: string; at: number } | null; critical: boolean;
};
export type Rv = { id: number; instance_id: number; reviewer_id: number; reviewer: string; kind: string; decision: string; decided_at: number;
  due_at: number | null; submitted_at: number; attempt: number; property_id: number; category: string; i_reviewer: number | null; comment: string | null };

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
export const dayStart = (d: string) => new Date(d + "T00:00").getTime();
export function quant(xs: number[], q: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
export const uniq = (xs: number[]) => [...new Set(xs)];
export const REVIEW_ST = ["review", "resub"];
const INPROG = ["review", "resub", "changes", "audit", "auditflag", "flagans"];
export const PASSED_ST = ["audit", "auditflag", "flagans", "done"];
export const REASON_GROUP: Record<string, string> = {
  "Photo missing": "Documentation", "Photo unclear": "Documentation", "Item not done": "Not done",
  "Count mismatch": "Data quality", "Wrong location": "Data quality", Other: "Other",
};

const toT = (r: Row): T => ({
  id: r.id, pid: r.property_id, property: r.property, city: r.city, cluster: r.cluster, task: r.task, tid: r.template_id, category: r.category,
  crit: r.criticality === "high", assignee: r.assignee, reviewer: r.reviewer, cbm: r.cbm, status: r.status, date: r.task_date,
  start: r.window_start_at, due: r.window_end_at, lateUntil: r.late_until_at, sub: r.first_submitted_at, attempt: r.attempt,
  max: r.attempts_allowed, since: r.status_since, reason: r.last_reason,
});

/** Ground team figures for a set of tasks. `sentBack` counts send-backs per task. */
export function ground(list: Row[], sentBack: Map<number, number>, passed: Set<number>, now: number) {
  const act = list.filter((r) => r.status !== "waived");
  const due = act.filter((r) => r.window_end_at <= now);
  const ids = (xs: Row[]) => xs.map((r) => r.id);
  const decided = act.filter((r) => r.first_decision);
  const sets = {
    assigned: ids(act), due: ids(due), completed: ids(act.filter((r) => r.first_submitted_at)),
    onTime: ids(due.filter((r) => r.first_submitted_at && r.first_submitted_at <= r.window_end_at)),
    late: ids(due.filter((r) => r.first_submitted_at && r.first_submitted_at > r.window_end_at)),
    overdue: ids(due.filter((r) => r.status === "notsub")),
    missed: ids(due.filter((r) => r.status === "missed")),
    decided: ids(decided),
    fta: ids(decided.filter((r) => r.first_decision === "pass")),
    returned: ids(act.filter((r) => (sentBack.get(r.id) ?? 0) >= 1)),
    repeat: ids(act.filter((r) => (sentBack.get(r.id) ?? 0) >= 2)),
    approved: ids(due.filter((r) => passed.has(r.id) || PASSED_ST.includes(r.status))),
    done: ids(due.filter((r) => r.status === "done")),
    notrect: ids(due.filter((r) => r.status === "notrect")),
    inprog: ids(due.filter((r) => INPROG.includes(r.status))),
    waived: ids(list.filter((r) => r.status === "waived")),
  };
  return sets;
}
type G = ReturnType<typeof ground>;

/** Review figures for checks decided in a period plus the backlog now. Checks are review attempts; tasks are counted once. */
export function reviewing(revs: Rv[], backlog: Row[], now: number) {
  const checks = revs.filter((r) => r.kind === "review");
  const byTask = new Map<number, Rv[]>();
  for (const x of checks) byTask.set(x.instance_id, [...(byTask.get(x.instance_id) ?? []), x]);
  const reviewed = [...byTask.keys()];
  const inSla = reviewed.filter((id) => byTask.get(id)!.every((x) => x.due_at && x.decided_at <= x.due_at));
  const pend = backlog.filter((r) => REVIEW_ST.includes(r.status));
  const over = pend.filter((r) => now - r.status_since > r.review_sla_h * HOUR);
  // Wait per task: from the submission to the first decision on it in the period.
  const tat = [...byTask.values()].map((t) => { const f = [...t].sort((a, b) => a.decided_at - b.decided_at)[0]; return f.decided_at - f.submitted_at; });
  const sentBack = reviewed.filter((id) => byTask.get(id)!.some((x) => x.decision === "changes"));
  return {
    reviewed, inSla, afterSla: reviewed.filter((id) => !inSla.includes(id)), pending: pend.map((r) => r.id), over: over.map((r) => r.id),
    rereview: pend.filter((r) => r.status === "resub").map((r) => r.id), requiring: uniq([...reviewed, ...pend.map((r) => r.id)]),
    sentBack, checks: checks.length, reReviewed: reviewed.filter((id) => byTask.get(id)!.length > 1),
    median: quant(tat, 0.5), p90: quant(tat, 0.9), checkIds: uniq(checks.map((x) => x.instance_id)),
  };
}

export async function buildCommand(u: User, sp: SP, now = Date.now()) {
  const today = isoDate(now);
  const preset = sp.range ?? "7d";
  const R = M.rangeFor(preset, today, sp.from, sp.to);
  const P = M.prevRange(R);
  // Trends need at least a week of points; today/yesterday show the week ending on that day.
  const tDays = Math.max(7, R.days);
  const tFrom = addDays(R.to, -tDays + 1), tPrevFrom = addDays(tFrom, -tDays);
  const mine = u.access_role === "reviewer" && sp.mine !== "0" && !sp.rv;
  // Reviewer filter: a picked reviewer, or yourself in My portfolio.
  const rvId = sp.rv ? Number(sp.rv) : mine ? u.id : null;
  const reviewerOpts = await all<{ id: number; name: string }>("SELECT id, name FROM users WHERE access_role='reviewer' ORDER BY name");
  const cats = (await all<{ category: string }>("SELECT DISTINCT category FROM templates ORDER BY category")).map((c) => c.category);

  const scope = await scopeProps(u);
  const G = (await geo()).filter((g) => scope.includes(g.id));
  // Search matches properties by name, cluster, city or CBM; every word has to match.
  const words = (sp.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (g: (typeof G)[number]) => words.every((w) => [g.property, g.cluster, g.city, g.cbm ?? ""].some((x) => x.toLowerCase().includes(w)));
  const props = G.filter((g) => (!sp.city || g.city === sp.city) && (!sp.cluster || g.cluster === sp.cluster) && (!sp.prop || g.property === sp.prop) && (!sp.cbm || String(g.cbmId) === sp.cbm) && hit(g)).map((g) => g.id);
  const keep = (r: { category: string; reviewer_id?: number | null; i_reviewer?: number | null }) =>
    (!sp.cat || r.category === sp.cat) && (rvId === null || (r.reviewer_id ?? r.i_reviewer) === rvId);
  const inProps = `IN (${props.join(",") || 0})`;

  const spanFrom = [P.from, tPrevFrom].sort()[0];
  const span = (await rows(`i.task_date BETWEEN ? AND ? AND i.property_id ${inProps}`, spanFrom, R.to)).filter(keep);
  const open = (await M.loadOpen(props)).filter(keep);
  const cur = span.filter((r) => r.task_date >= R.from && r.task_date <= R.to);
  const prev = span.filter((r) => r.task_date >= P.from && r.task_date <= P.to);

  const revAll = (await all<Rv>(`SELECT rv.id, rv.instance_id, rv.reviewer_id, u.name reviewer, rv.kind, rv.decision, rv.decided_at, rv.due_at, rv.comment,
      s.submitted_at, s.attempt, i.property_id, t.category, i.reviewer_id i_reviewer
    FROM reviews rv JOIN users u ON u.id=rv.reviewer_id JOIN submissions s ON s.id=rv.submission_id JOIN instances i ON i.id=rv.instance_id JOIN templates t ON t.id=i.template_id
    WHERE rv.decided_at>=? AND i.property_id ${inProps}`, dayStart(spanFrom) - 7 * 864e5)).filter(keep);
  const inR = (r: { from: string; to: string }) => (x: { decided_at: number }) => x.decided_at >= dayStart(r.from) && x.decided_at < dayStart(r.to) + 864e5;
  const revCur = revAll.filter(inR(R)), revPrev = revAll.filter(inR(P));
  const sentBack = new Map<number, number>(), passed = new Set<number>();
  for (const x of revAll) if (x.kind === "review") {
    if (x.decision === "changes") sentBack.set(x.instance_id, (sentBack.get(x.instance_id) ?? 0) + 1);
    if (x.decision === "pass") passed.add(x.instance_id);
  }

  const gC = ground(cur, sentBack, passed, now), gP = ground(prev, sentBack, passed, now);
  const vC = reviewing(revCur, open, now), vP = reviewing(revPrev, [], now);

  // Every task any figure points at, so lists and the drawer use the same records.
  const tasks = new Map<number, T>();
  for (const r of [...cur, ...open]) tasks.set(r.id, toT(r));
  const ensure = async (want: number[]) => {
    const miss = uniq(want).filter((id) => !tasks.has(id));
    if (miss.length) for (const r of await rows(`i.id IN (${miss.join(",")})`)) tasks.set(r.id, toT(r));
  };
  await ensure(revCur.map((x) => x.instance_id));

  const k = (ids: number[], of?: number[], prevIds?: number[], prevOf?: number[]): K =>
    ({ n: ids.length, ids, ...(of ? { of: of.length, rate: pct(ids.length, of.length) } : {}),
      ...(prevIds ? { prev: prevOf ? pct(prevIds.length, prevOf.length) : prevIds.length } : {}) });

  // Review missed: tasks from the period that were submitted but are still unreviewed after their review time limit.
  const reviewMissed = (list: Row[]) => list.filter((r) => REVIEW_ST.includes(r.status) && now - r.status_since > r.review_sla_h * HOUR).map((r) => r.id);
  const submittedIn = cur.filter((r) => r.first_submitted_at).map((r) => r.id);
  const groundK = {
    assigned: k(gC.assigned, undefined, gP.assigned), due: k(gC.due, undefined, gP.due), completed: k(gC.completed, gC.assigned, gP.completed, gP.assigned),
    onTime: k(gC.onTime, gC.due, gP.onTime, gP.due), late: k(gC.late, gC.due, gP.late, gP.due),
    overdue: k(gC.overdue, gC.due), missed: k(gC.missed, gC.due, gP.missed, gP.due),
    fta: k(gC.fta, gC.decided, gP.fta, gP.decided), returned: k(gC.returned, gC.decided, gP.returned, gP.decided),
    repeat: k(gC.repeat, gC.decided, gP.repeat, gP.decided),
  };
  const reviewK = {
    requiring: k(vC.requiring), reviewed: k(vC.reviewed, undefined, vP.reviewed),
    inSla: k(vC.inSla, vC.reviewed, vP.inSla, vP.reviewed), afterSla: k(vC.afterSla, vC.reviewed, vP.afterSla, vP.reviewed),
    pending: k(vC.pending), over: k(vC.over, vC.pending), rereview: k(vC.rereview), missed: k(reviewMissed(cur), submittedIn),
    median: { ms: vC.median, prev: vP.median, ids: vC.checkIds }, p90: { ms: vC.p90, prev: vP.p90, ids: vC.checkIds },
    checks: vC.checks,
  };
  const outcome = {
    done: k(gC.done, gC.due, gP.done, gP.due), inprog: k(gC.inprog, gC.due), notsub: k(gC.overdue, gC.due),
    missed: k(gC.missed, gC.due), notrect: k(gC.notrect, gC.due), waived: k(gC.waived), approved: k(gC.approved, gC.due, gP.approved, gP.due),
  };

  // ---------- Action queue ----------
  const openIds = open.map((r) => r.id);
  const evs = openIds.length ? await all<{ instance_id: number; type: string; at: number; detail: string; actor: string | null }>(
    `SELECT e.instance_id, e.type, e.at, e.detail, u.name actor FROM events e LEFT JOIN users u ON u.id=e.actor_id
     WHERE e.type IN ('acknowledged','escalated') AND e.instance_id IN (${openIds.join(",")}) ORDER BY e.at`) : [];
  const lastRev = openIds.length ? await all<{ instance_id: number; comment: string | null; fl: string | null; n: number }>(
    `SELECT rv.instance_id, rv.comment, (SELECT group_concat(f.reason || COALESCE(': ' || NULLIF(f.comment,''), ''), '; ') FROM review_flags f WHERE f.review_id=rv.id) fl,
       (SELECT count(*) FROM reviews x WHERE x.instance_id=rv.instance_id AND x.kind='review' AND x.decision='changes') n
     FROM reviews rv WHERE rv.instance_id IN (${openIds.join(",")}) ORDER BY rv.decided_at`) : [];
  const commentOf = new Map<number, string | null>(), rejOf = new Map<number, number>();
  for (const x of lastRev) { commentOf.set(x.instance_id, [x.comment, x.fl].filter(Boolean).join(" · ") || null); rejOf.set(x.instance_id, x.n); }

  const issues: Issue[] = [];
  for (const r of open) {
    const age = now - r.status_since, crit = r.criticality === "high";
    const base = { key: `i${r.id}`, id: r.id, ids: [r.id], property: r.property, pid: r.property_id, city: r.city, cluster: r.cluster, task: r.task,
      status: r.status, rejections: rejOf.get(r.id) ?? 0, comment: commentOf.get(r.id) ?? null, critical: crit,
      ack: null as Issue["ack"], esc: null as Issue["esc"] };
    const reviewSla = r.review_sla_h * HOUR, auditSla = r.audit_sla_h * HOUR;
    let it: Pick<Issue, "cat" | "type" | "sev" | "owner" | "ownerRole" | "overdue"> | null = null;
    if (r.status === "notsub" && crit)
      it = { cat: "critical", type: "Critical task not submitted", sev: "Critical", owner: r.assignee ?? "Unassigned", ownerRole: "Ground team", overdue: now - r.window_end_at };
    else if (r.status === "changes" && crit && r.attempt >= r.attempts_allowed - 1)
      it = { cat: "critical", type: "Critical task, last attempt left", sev: "Critical", owner: r.assignee ?? "Unassigned", ownerRole: "Ground team", overdue: null };
    else if (REVIEW_ST.includes(r.status) && age > reviewSla)
      it = { cat: "review", type: r.status === "resub" ? "Re-review past SLA" : "Review past SLA", sev: crit ? "Critical" : !r.reviewer || age > 2 * reviewSla ? "High" : "Medium",
        owner: r.reviewer ?? "Unassigned", ownerRole: "Reviewer", overdue: age - reviewSla };
    else if (r.status === "audit" && age > auditSla)
      it = { cat: "review", type: "Audit past SLA", sev: "Medium", owner: r.auditor ?? "Unassigned", ownerRole: "Auditor", overdue: age - auditSla };
    else if (r.status === "changes" && r.attempt >= 2)
      it = { cat: "repeat", type: `Sent back ${rejOf.get(r.id) ?? r.attempt} times`, sev: r.attempt >= r.attempts_allowed - 1 ? "High" : "Medium",
        owner: r.assignee ?? "Unassigned", ownerRole: "Ground team", overdue: age > 24 * HOUR ? age - 24 * HOUR : null };
    else if (r.status === "changes" && age > 24 * HOUR)
      it = { cat: "ground", type: "Correction overdue", sev: "Medium", owner: r.assignee ?? "Unassigned", ownerRole: "Ground team", overdue: age - 24 * HOUR };
    else if (r.status === "notsub")
      it = { cat: "ground", type: "Past deadline, not submitted", sev: r.late_until_at - now < 3 * HOUR ? "Medium" : "Low", owner: r.assignee ?? "Unassigned", ownerRole: "Ground team", overdue: now - r.window_end_at };
    else if (r.status === "auditflag" && age > 48 * HOUR)
      it = { cat: "exception", type: "Audit questions unanswered", sev: "High", owner: r.cbm ?? "Unassigned", ownerRole: "CBM", overdue: age - 48 * HOUR };
    else if (r.status === "flagans" && age > auditSla)
      it = { cat: "exception", type: "Flag answers not closed", sev: "Medium", owner: r.auditor ?? "Unassigned", ownerRole: "Auditor", overdue: age - auditSla };
    if (!it) continue;
    const mineEv = evs.filter((e) => e.instance_id === r.id && e.at >= r.status_since);
    const a = [...mineEv].reverse().find((e) => e.type === "acknowledged"), e = [...mineEv].reverse().find((e) => e.type === "escalated");
    issues.push({ ...base, ...it, ack: a ? { by: a.actor ?? "", at: a.at } : null, esc: e ? { detail: e.detail, by: e.actor ?? "", at: e.at } : null });
  }

  // ---------- Per property ----------
  const byProp = (list: Row[]) => { const m = new Map<number, Row[]>(); for (const r of list) m.set(r.property_id, [...(m.get(r.property_id) ?? []), r]); return m; };
  const curP = byProp(cur), prevP = byProp(prev), openP = byProp(open);
  const revBy = (list: Rv[], key: (x: Rv) => string | number) => { const m = new Map<string | number, Rv[]>(); for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return m; };
  const revCurP = revBy(revCur, (x) => x.property_id);
  const days: string[] = []; for (let d = R.from; d <= R.to; d = addDays(d, 1)) days.push(d);
  const dailyOnTime = (list: Row[]) => days.map((d) => { const g = ground(list.filter((x) => x.task_date === d), sentBack, passed, now); return pct(g.onTime.length, g.due.length); });

  const properties = G.filter((g) => props.includes(g.id)).map((g) => {
    const gc = ground(curP.get(g.id) ?? [], sentBack, passed, now), gp = ground(prevP.get(g.id) ?? [], sentBack, passed, now);
    const v = reviewing(revCurP.get(g.id) ?? [], openP.get(g.id) ?? [], now);
    const critOpen = issues.filter((i) => i.pid === g.id && i.sev === "Critical").map((i) => i.id!);
    const enough = gc.due.length >= 3;
    return {
      id: g.id, name: g.property, city: g.city, cluster: g.cluster, cbm: (curP.get(g.id) ?? openP.get(g.id) ?? [])[0]?.cbm ?? "",
      due: gc.due, onTime: pct(gc.onTime.length, gc.due.length), onTimePrev: pct(gp.onTime.length, gp.due.length),
      fta: pct(gc.fta.length, gc.decided.length), approved: pct(gc.approved.length, gc.due.length),
      overdue: gc.overdue, missed: gc.missed, pending: v.pending, over: v.over, repeat: gc.repeat, critOpen,
      spark: dailyOnTime(curP.get(g.id) ?? []),
      // Risk inputs, each 0 to 1. The weights are applied in the browser so they can be changed.
      risk: enough ? {
        late: 1 - gc.onTime.length / gc.due.length, missed: gc.missed.length / gc.due.length,
        repeat: gc.decided.length ? gc.repeat.length / gc.decided.length : 0,
        sla: v.reviewed.length + v.over.length ? (v.afterSla.length + v.over.length) / (v.reviewed.length + v.over.length) : 0,
        critical: Math.min(1, critOpen.length / 2),
      } : null,
    };
  });

  // Property-level exception: many missed tasks.
  for (const p of properties) {
    const rate = p.due.length ? p.missed.length / p.due.length : 0;
    if (p.due.length >= 5 && rate > 0.2) issues.push({
      key: `p${p.id}`, ids: p.missed, cat: "exception", type: `Missed ${Math.round(rate * 100)}% of tasks`, sev: rate > 0.3 ? "High" : "Medium",
      property: p.name, pid: p.id, city: p.city, cluster: p.cluster, task: `${p.missed.length} of ${p.due.length} tasks missed`, owner: p.cbm || "Unassigned", ownerRole: "CBM",
      status: "missed", overdue: null, rejections: 0, comment: null, ack: null, esc: null, critical: false });
  }
  const SEV = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  issues.sort((a, b) => SEV[b.sev] - SEV[a.sev] || (b.overdue ?? 0) - (a.overdue ?? 0));

  // ---------- City and cluster comparison ----------
  const compare = (key: "city" | "cluster") => {
    const names = [...new Set(G.filter((g) => props.includes(g.id)).map((g) => g[key]))];
    return names.map((name) => {
      const ps = G.filter((g) => g[key] === name && props.includes(g.id)).map((g) => g.id);
      const gc = ground(cur.filter((r) => ps.includes(r.property_id)), sentBack, passed, now), gp = ground(prev.filter((r) => ps.includes(r.property_id)), sentBack, passed, now);
      const v = reviewing(revCur.filter((x) => ps.includes(x.property_id)), open.filter((r) => ps.includes(r.property_id)), now);
      const vp = reviewing(revPrev.filter((x) => ps.includes(x.property_id)), [], now);
      return { name, city: G.find((g) => g[key] === name)!.city, props: ps.length, due: gc.due, onTime: pct(gc.onTime.length, gc.due.length), onTimePrev: pct(gp.onTime.length, gp.due.length),
        missed: gc.missed, fta: pct(gc.fta.length, gc.decided.length), inSla: pct(v.inSla.length, v.reviewed.length), inSlaPrev: pct(vp.inSla.length, vp.reviewed.length),
        over: v.over, repeat: gc.repeat };
    }).sort((a, b) => (a.onTime ?? 101) - (b.onTime ?? 101));
  };

  // ---------- Reviewers ----------
  const revByName = revBy(revCur, (x) => x.reviewer);
  const reviewerNames = [...new Set([...revCur.filter((x) => x.kind === "review").map((x) => x.reviewer), ...open.filter((r) => REVIEW_ST.includes(r.status) && r.reviewer).map((r) => r.reviewer!)])];
  const reviewers = reviewerNames.map((name) => {
    const mineRev = (revByName.get(name) ?? []);
    const v = reviewing(mineRev, open.filter((r) => r.reviewer === name), now);
    const assignedProps = new Set([...cur, ...open].filter((r) => r.reviewer === name).map((r) => r.property_id));
    return { name, props: assignedProps.size, requiring: v.requiring, reviewed: v.reviewed, inSla: pct(v.inSla.length, v.reviewed.length), afterSla: v.afterSla,
      pending: v.pending, over: v.over, median: v.median, p90: v.p90, reReviewed: v.reReviewed,
      missed: reviewMissed(cur.filter((r) => r.reviewer === name)),
      sentBack: v.sentBack, sentBackRate: pct(v.sentBack.length, v.reviewed.length),
      daily: days.map((d) => uniq(mineRev.filter((x) => x.kind === "review" && x.decided_at >= dayStart(d) && x.decided_at < dayStart(d) + 864e5).map((x) => x.instance_id)).length) };
  }).sort((a, b) => b.over.length - a.over.length || (a.inSla ?? 0) - (b.inSla ?? 0));

  // ---------- CBMs ----------
  const fixEv = await all<{ instance_id: number; type: string; at: number }>(
    `SELECT e.instance_id, e.type, e.at FROM events e JOIN instances i ON i.id=e.instance_id WHERE e.type IN ('changes_requested','resubmitted') AND e.at>=? AND e.at<? AND i.property_id ${inProps} ORDER BY e.at`,
    dayStart(R.from), dayStart(R.to) + 864e5);
  const fixTimes = new Map<number, number[]>(); // property -> ms from send-back to resubmission
  { const asked = new Map<number, number>(), fixed = new Set<number>();
    for (const e of fixEv) {
      if (e.type === "changes_requested") { if (!asked.has(e.instance_id)) asked.set(e.instance_id, e.at); }
      // One fix time per task: its first send-back to its first resubmission.
      else if (asked.has(e.instance_id) && !fixed.has(e.instance_id)) { fixed.add(e.instance_id); const t = tasks.get(e.instance_id); if (t) fixTimes.set(t.pid, [...(fixTimes.get(t.pid) ?? []), e.at - asked.get(e.instance_id)!]); }
    } }
  const cbms = [...new Set(properties.map((p) => p.cbm).filter(Boolean))].map((name) => {
    const ps = properties.filter((p) => p.cbm === name).map((p) => p.id);
    const list = cur.filter((r) => ps.includes(r.property_id));
    const gc = ground(list, sentBack, passed, now);
    const iss = issues.filter((i) => ps.includes(i.pid));
    return { name, props: ps.length, due: gc.due, onTime: pct(gc.onTime.length, gc.due.length), missed: gc.missed, fta: pct(gc.fta.length, gc.decided.length),
      repeat: gc.repeat, issues: uniq(iss.flatMap((i) => i.ids)), fix: quant(ps.flatMap((p) => fixTimes.get(p) ?? []), 0.5),
      escalated: iss.filter((i) => i.esc).map((i) => i.id!), spark: dailyOnTime(list) };
  }).sort((a, b) => (a.onTime ?? 0) - (b.onTime ?? 0));

  // ---------- Lifecycle (tasks due in the period, each counted once) ----------
  const dueRows = cur.filter((r) => gC.due.includes(r.id));
  const submitted = dueRows.filter((r) => r.first_submitted_at);
  const reviewedT = dueRows.filter((r) => r.first_decision);
  const returnedT = dueRows.filter((r) => (sentBack.get(r.id) ?? 0) > 0);
  const resubT = returnedT.filter((r) => r.attempt >= 2);
  const fixedT = returnedT.filter((r) => passed.has(r.id) || PASSED_ST.includes(r.status));
  const firstCheck = new Map<number, number>();
  for (const x of revAll) if (x.kind === "review" && x.attempt <= 1 && !firstCheck.has(x.instance_id)) firstCheck.set(x.instance_id, x.decided_at - x.submitted_at);
  const recheckBy = new Map<number, number>();
  for (const x of revCur) if (x.kind === "review" && x.attempt > 1 && !recheckBy.has(x.instance_id)) recheckBy.set(x.instance_id, x.decided_at - x.submitted_at);
  const recheck = [...recheckBy.values()];
  const ids = (xs: Row[]) => xs.map((r) => r.id);
  const lifecycle = {
    stages: [
      { key: "due", label: "Deadline passed", ids: gC.due },
      { key: "sub", label: "Submitted", ids: ids(submitted), time: quant(submitted.map((r) => r.first_submitted_at! - r.window_start_at), 0.5), timeLabel: "to submit" },
      { key: "rev", label: "Reviewed", ids: ids(reviewedT), time: quant(reviewedT.map((r) => firstCheck.get(r.id)).filter((x): x is number => x !== undefined), 0.5), timeLabel: "to first review" },
      { key: "fta", label: "Approved first time", ids: gC.fta },
    ],
    fix: [
      { key: "ret", label: "Sent back", ids: ids(returnedT) },
      { key: "resub", label: "Resubmitted", ids: ids(resubT), time: quant([...fixTimes.values()].flat(), 0.5), timeLabel: "to fix" },
      { key: "fixed", label: "Approved after fixing", ids: ids(fixedT), time: quant(recheck, 0.5), timeLabel: "to re-review" },
    ],
    finalApproved: gC.approved,
    stuck: [
      { label: "Not submitted", ids: open.filter((r) => r.status === "notsub").map((r) => r.id) },
      { label: "Waiting for review", ids: open.filter((r) => r.status === "review").map((r) => r.id) },
      { label: "Being fixed", ids: open.filter((r) => r.status === "changes").map((r) => r.id) },
      { label: "Waiting for re-review", ids: open.filter((r) => r.status === "resub").map((r) => r.id) },
    ],
  };

  // ---------- Rejection reasons (tasks sent back in the period, by reason) ----------
  type F = { instance_id: number; reason: string; decided_at: number; property: string; task: string; city: string; category: string; i_reviewer: number | null };
  const flagsAll = (await all<F>(`SELECT DISTINCT rv.instance_id, f.reason, rv.decided_at, p.name property, t.name task, c.name city, t.category, i.reviewer_id i_reviewer
    FROM review_flags f JOIN reviews rv ON rv.id=f.review_id JOIN instances i ON i.id=rv.instance_id JOIN templates t ON t.id=i.template_id
    JOIN properties p ON p.id=i.property_id JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id
    WHERE rv.kind='review' AND rv.decided_at>=? AND rv.decided_at<? AND i.property_id ${inProps}`, dayStart(P.from), dayStart(R.to) + 864e5)).filter(keep);
  const fC = flagsAll.filter(inR(R)), fP = flagsAll.filter(inR(P));
  const top = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0] ?? null; };
  const reasonNames = [...new Set(fC.map((f) => f.reason))];
  const reasons = reasonNames.map((reason) => {
    const fs = fC.filter((f) => f.reason === reason);
    const tids = uniq(fs.map((f) => f.instance_id));
    const byTask = new Map<number, F>(); for (const f of fs) byTask.set(f.instance_id, f);
    const one = [...byTask.values()];
    return { reason, group: REASON_GROUP[reason] ?? "Other", ids: tids, share: pct(tids.length, vC.reviewed.length),
      prev: uniq(fP.filter((f) => f.reason === reason).map((f) => f.instance_id)).length,
      topProperty: top(one.map((f) => f.property)), topTask: top(one.map((f) => f.task)), topCity: top(one.map((f) => f.city)) };
  }).sort((a, b) => b.ids.length - a.ids.length);
  await ensure(fC.map((f) => f.instance_id));

  // ---------- Trends ----------
  const tDayList = (from: string) => Array.from({ length: tDays }, (_, i) => addDays(from, i));
  const subsAll = (await all<{ instance_id: number; submitted_at: number; decided: number | null; category: string; i_reviewer: number | null }>(
    `SELECT s.instance_id, s.submitted_at, (SELECT min(rv.decided_at) FROM reviews rv WHERE rv.submission_id=s.id AND rv.kind='review') decided, t.category, i.reviewer_id i_reviewer
     FROM submissions s JOIN instances i ON i.id=s.instance_id JOIN templates t ON t.id=i.template_id
     WHERE s.submitted_at>=? AND i.property_id ${inProps}`, dayStart(tPrevFrom) - 7 * 864e5)).filter(keep);
  const firstData = span.length ? span.reduce((m, r) => (r.task_date < m ? r.task_date : m), span[0].task_date) : R.to;
  const point = (d: string) => {
    if (d < firstData) return null; // No records before the data starts: show a gap, not a zero.
    const list = span.filter((r) => r.task_date === d);
    const g = ground(list, sentBack, passed, now);
    const s = dayStart(d), e = s + 864e5;
    const dayRev = revAll.filter((x) => x.kind === "review" && x.decided_at >= s && x.decided_at < e);
    const v = reviewing(dayRev, [], now);
    const back = dayRev.filter((x) => x.decision === "changes");
    const backlog = e <= now ? subsAll.filter((x) => x.submitted_at < e && (x.decided === null || x.decided >= e)).map((x) => x.instance_id) : null;
    return {
      onTime: [g.onTime, g.due], inSla: [v.inSla, v.reviewed], fta: [g.fta, g.decided], approved: [g.approved, g.due],
      overdue: [[...g.overdue, ...g.missed]], backlog: backlog ? [backlog] : null, rejections: [uniq(back.map((x) => x.instance_id))],
      repeatRate: [uniq(back.filter((x) => x.attempt >= 2).map((x) => x.instance_id)), uniq(back.map((x) => x.instance_id))],
    } as Record<string, number[][] | null>;
  };
  const trend = { days: tDayList(tFrom), cur: tDayList(tFrom).map(point), prev: tDayList(tPrevFrom).map(point), firstData };
  await ensure([...trend.cur, ...trend.prev].flatMap((p) => (p ? Object.values(p).flatMap((v) => (v ? v.flat() : [])) : [])));

  // ---------- Recurring patterns (repeats, not one-offs) ----------
  const recurring: { title: string; sub: string; ids: number[]; owner: string }[] = [];
  const grp = (list: Row[], key: (r: Row) => string) => { const m = new Map<string, Row[]>(); for (const r of list) m.set(key(r), [...(m.get(key(r)) ?? []), r]); return m; };
  for (const [, l] of grp(cur.filter((r) => r.status === "missed"), (r) => `${r.property_id}:${r.template_id}`))
    if (l.length >= 2) recurring.push({ title: `${l[0].task} missed ${l.length} times`, sub: l[0].property, ids: ids(l), owner: l[0].cbm ?? "" });
  for (const [, l] of grp(cur.filter((r) => (sentBack.get(r.id) ?? 0) > 0), (r) => `${r.property_id}:${r.template_id}`))
    if (l.length >= 3) recurring.push({ title: `${l[0].task} sent back on ${l.length} days`, sub: l[0].property, ids: ids(l), owner: l[0].cbm ?? "" });
  { const m = new Map<string, F[]>(); for (const f of fC) m.set(`${f.property}:${f.reason}`, [...(m.get(`${f.property}:${f.reason}`) ?? []), f]);
    for (const [, l] of m) { const t = uniq(l.map((f) => f.instance_id)); if (t.length >= 3) recurring.push({ title: `“${l[0].reason}” ${t.length} times`, sub: l[0].property, ids: t, owner: tasks.get(t[0])?.cbm ?? "" }); } }
  for (const c of compare("cluster")) {
    const v = reviewing(revCur.filter((x) => G.find((g) => g.id === x.property_id)?.cluster === c.name), open.filter((r) => r.cluster === c.name), now);
    const late = v.afterSla.length + v.over.length, base = v.reviewed.length + v.over.length;
    if (base >= 5 && late / base >= 0.3) recurring.push({ title: `Reviews late for ${Math.round((late / base) * 100)}% of tasks`, sub: `${c.name} cluster`, ids: uniq([...v.afterSla, ...v.over]), owner: "Reviewers" });
  }
  recurring.sort((a, b) => b.ids.length - a.ids.length);
  // Keep the list varied: at most three of each kind of pattern.
  const kinds = new Map<string, number>();
  const varied = recurring.filter((r) => { const k = r.title.replace(/[\d%]+/g, "").slice(0, 14); kinds.set(k, (kinds.get(k) ?? 0) + 1); return kinds.get(k)! <= 3; });

  // ---------- Handover ----------
  const closedToday = (await all<{ instance_id: number }>(
    `SELECT DISTINCT e.instance_id FROM events e JOIN instances i ON i.id=e.instance_id WHERE e.type IN ('passed','audit_passed','flags_closed') AND e.at>=? AND i.property_id ${inProps}`,
    dayStart(today))).map((x) => x.instance_id);
  await ensure(closedToday);
  const tomorrow = open.filter((r) => r.status === "notsub" && isoDate(r.late_until_at) === addDays(today, 1)).map((r) => r.id);

  // ---------- Housekeeping headcount (sample numbers) ----------
  const staff = (await all<{ property_id: number; ideal_hk: number; current_hk: number; ideal_shk: number; current_shk: number }>(`SELECT * FROM staffing WHERE property_id ${inProps}`))
    .map((x) => ({ ...x, name: G.find((g) => g.id === x.property_id)!.property }));

  return {
    now, today, preset, R, P, mine, role: u.access_role, userName: u.name, canEscalate: ["admin", "reviewer", "auditor"].includes(u.access_role),
    geo: G, cats, filters: { city: sp.city, cluster: sp.cluster, prop: sp.prop, cat: sp.cat, rv: sp.rv, cbm: sp.cbm, q: sp.q }, reviewerOpts, propCount: props.length,
    tasks: Object.fromEntries(tasks), ground: groundK, review: reviewK, outcome, issues, properties, cities: compare("city"), clusters: compare("cluster"),
    reviewers, cbms, lifecycle, reasons, reasonsTotal: uniq(fC.map((f) => f.instance_id)), reasonsPrevTotal: uniq(fP.map((f) => f.instance_id)).length,
    reviewedTotal: vC.reviewed.length, trend, recurring: varied.slice(0, 8), prevHasData: prev.length > 0 && P.from >= (span.length ? span.reduce((m, r) => (r.task_date < m ? r.task_date : m), span[0].task_date) : P.from), closedToday, tomorrow, staff,
  };
}
export type CC = Awaited<ReturnType<typeof buildCommand>>;
