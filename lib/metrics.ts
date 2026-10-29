// Command-center metrics. Definitions follow the audit report's KPI fixes:
// on-time uses tasks past their deadline as the denominator, review SLA counts the overdue backlog,
// "verified" counts tasks (not pass decisions), and every per-person rollup credits one accountable CBM.
import { all } from "./db";
import { HOUR, addDays, isoDate } from "./time";
import { rows, Row } from "./queries";

export type Range = { from: string; to: string };
export function rangeFor(preset: string, today: string, from?: string, to?: string): Range & { days: number } {
  const n = { today: 1, yday: 1, "7d": 7, "14d": 14, "30d": 30 }[preset] ?? 0;
  if (preset === "custom" && from && to) return { from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 };
  if (preset === "yday") return { from: addDays(today, -1), to: addDays(today, -1), days: 1 };
  return { from: addDays(today, -(n || 7) + 1), to: today, days: n || 7 };
}
export const prevRange = (r: Range & { days: number }): Range => ({ from: addDays(r.from, -r.days), to: addDays(r.from, -1) });

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
const slaOf = (r: Row) => (["review", "resub"].includes(r.status) ? r.review_sla_h : ["audit", "flagans"].includes(r.status) ? r.audit_sla_h : r.status === "changes" ? 24 : r.status === "auditflag" ? 48 : 0);

export function execution(list: Row[], now: number) {
  const due = list.filter((r) => r.status !== "waived" && r.window_end_at <= now);
  const onTime = due.filter((r) => r.first_submitted_at && r.first_submitted_at <= r.window_end_at).length;
  const late = due.filter((r) => r.first_submitted_at && r.first_submitted_at > r.window_end_at).length;
  const open = due.filter((r) => r.status === "notsub").length;
  const missed = due.filter((r) => r.status === "missed").length;
  const decided = list.filter((r) => r.first_decision);
  const fpa = decided.filter((r) => r.first_decision === "pass").length;
  const verified = due.filter((r) => r.status === "done").length;
  return {
    due: due.length, onTime, late, open, missed, verified, decided: decided.length, fpa,
    onTimeRate: pct(onTime, due.length), fpaRate: pct(fpa, decided.length), missedRate: pct(missed, due.length), verifiedRate: pct(verified, due.length),
    waived: list.filter((r) => r.status === "waived").length,
  };
}

type Rev = { id: number; instance_id: number; reviewer_id: number; reviewer: string; kind: string; decision: string; decided_at: number; due_at: number | null; submitted_at: number; property_id: number };
export function reviewsIn(r: Range, props: number[]): Rev[] {
  const from = new Date(r.from + "T00:00").getTime(), to = new Date(r.to + "T00:00").getTime() + 864e5;
  return all<Rev>(`SELECT rv.id, rv.instance_id, rv.reviewer_id, u.name reviewer, rv.kind, rv.decision, rv.decided_at, rv.due_at, s.submitted_at, i.property_id
    FROM reviews rv JOIN users u ON u.id=rv.reviewer_id JOIN submissions s ON s.id=rv.submission_id JOIN instances i ON i.id=rv.instance_id
    WHERE rv.decided_at>=? AND rv.decided_at<? AND i.property_id IN (${props.join(",") || 0})`, from, to);
}

/** Review metrics counted per task: a task is checked in time when every check on it met its time limit. */
export function review(revs: Rev[], openRows: Row[], now: number) {
  const byTask = new Map<number, Rev[]>();
  for (const x of revs.filter((r) => r.kind === "review")) byTask.set(x.instance_id, [...(byTask.get(x.instance_id) ?? []), x]);
  const tasks = [...byTask.values()];
  const onTime = tasks.filter((t) => t.every((x) => x.due_at && x.decided_at <= x.due_at)).length;
  const backlog = openRows.filter((r) => ["review", "resub"].includes(r.status));
  const pendingOver = backlog.filter((r) => now - r.status_since > r.review_sla_h * HOUR).length;
  const audited = new Map<number, boolean>();
  for (const x of revs.filter((r) => r.kind === "audit")) audited.set(x.instance_id, (audited.get(x.instance_id) ?? false) || x.decision === "fail");
  return {
    tasks: tasks.length, onTime, pending: backlog.length, pendingOver,
    slaRate: pct(onTime, tasks.length + pendingOver),
    // Time from a task's first submission in range to its first check.
    medianTat: median(tasks.map((t) => { const f = [...t].sort((a, b) => a.decided_at - b.decided_at)[0]; return f.decided_at - f.submitted_at; })),
    audits: audited.size, auditFails: [...audited.values()].filter(Boolean).length,
  };
}

export type Attention = { id?: number; sev: "r" | "a"; title: string; sub: string; owner: string; age: number; href: string };
export function attention(openRows: Row[], period: Row[], now: number, q: string): Attention[] {
  const out: Attention[] = [];
  for (const r of openRows) {
    const age = (now - r.status_since) / HOUR, sla = slaOf(r);
    const href = `/review/${r.id}`;
    if (["review", "resub"].includes(r.status) && age > sla)
      out.push({ id: r.id, sev: age > 2 * sla ? "r" : "a", title: `Check overdue · ${r.task}`, sub: `${r.property} · ${Math.round(age)}h (limit ${sla}h)`, owner: r.reviewer ?? "Unassigned", age, href });
    else if (r.status === "audit" && age > sla)
      out.push({ id: r.id, sev: "a", title: `Audit overdue · ${r.task}`, sub: `${r.property} · ${Math.round(age)}h (limit ${sla}h)`, owner: r.auditor ?? "Unassigned", age, href });
    else if (r.status === "changes" && r.attempt >= r.attempts_allowed - 1)
      out.push({ id: r.id, sev: r.criticality === "high" ? "r" : "a", title: `Sent back ${r.attempt} times · ${r.task}`, sub: `${r.property} · “${r.last_reason}” · last try left`, owner: r.assignee ?? "", age, href });
    else if (r.status === "auditflag" && age > 48)
      out.push({ id: r.id, sev: "a", title: `Audit questions unanswered · ${r.task}`, sub: `${r.property} · ${Math.round(age)}h`, owner: r.cbm ?? "", age, href });
    else if (r.status === "notsub" && r.criticality === "high")
      out.push({ id: r.id, sev: "r", title: `Critical task not done · ${r.task}`, sub: `${r.property} · due by ${new Date(r.late_until_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, owner: r.assignee ?? "", age, href });
  }
  const byProp = new Map<number, Row[]>();
  for (const r of period) byProp.set(r.property_id, [...(byProp.get(r.property_id) ?? []), r]);
  for (const [, list] of byProp) {
    const e = execution(list, now);
    if (e.due >= 5 && (e.missedRate ?? 0) > 20)
      out.push({ sev: (e.missedRate ?? 0) > 30 ? "r" : "a", title: `${list[0].property} missed ${e.missedRate}% of tasks`, sub: `${e.missed} of ${e.due} missed`, owner: list[0].cbm ?? "", age: 0,
        href: `/queue?tab=missed&prop=${encodeURIComponent(list[0].property)}&${q}` });
  }
  return out.sort((a, b) => (a.sev === b.sev ? b.age - a.age : a.sev === "r" ? -1 : 1));
}

export function dailyOnTime(list: Row[], r: Range, now: number) {
  const out: (number | null)[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(execution(list.filter((x) => x.task_date === d), now).onTimeRate);
  return out;
}

export function load(props: number[], r: Range) {
  return rows(`i.task_date BETWEEN ? AND ? AND i.property_id IN (${props.join(",") || 0})`, r.from, r.to);
}
export function loadOpen(props: number[]) {
  return rows(`i.status IN ('review','resub','audit','auditflag','flagans','changes','notsub') AND i.property_id IN (${props.join(",") || 0})`);
}
export function reasons(r: Range, props: number[]) {
  const from = new Date(r.from + "T00:00").getTime(), to = new Date(r.to + "T00:00").getTime() + 864e5;
  return all<{ reason: string; n: number }>(`SELECT f.reason, count(DISTINCT rv.instance_id) n FROM review_flags f JOIN reviews rv ON rv.id=f.review_id JOIN instances i ON i.id=rv.instance_id
    WHERE rv.kind='review' AND rv.decided_at>=? AND rv.decided_at<? AND i.property_id IN (${props.join(",") || 0}) GROUP BY f.reason ORDER BY n DESC`, from, to);
}
export function reopenAfterPass(r: Range) {
  const from = new Date(r.from + "T00:00").getTime(), to = new Date(r.to + "T00:00").getTime() + 864e5;
  return all<{ instance_id: number }>("SELECT instance_id FROM events WHERE type='reopened' AND at>=? AND at<?", from, to).map((x) => x.instance_id);
}
export { isoDate };
