import { boot } from "@/lib/boot";
import { rows, STATUS_LABEL, STATUS_PILL, Row } from "@/lib/queries";
import { viewsFor } from "@/lib/views";
import { isoDate, fmtDate, fmtDur, fmtDateTime } from "@/lib/time";
import TasksClient, { MyTask } from "@/components/TasksClient";

export default async function MyTasks({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string; range?: string; from?: string; to?: string }> }) {
  const u = await boot();
  const sp = await searchParams;
  const tab = sp.tab ?? "now";
  const today = isoDate(Date.now());
  // Dates: today by default, or yesterday, the last 7 days, or a custom From–To. An old ?date= link means that one day.
  const back = (n: number) => isoDate(Date.now() - n * 864e5);
  const range = sp.date ? "custom" : sp.range ?? "today";
  const [from, to] = sp.date ? [sp.date, sp.date] : range === "yday" ? [back(1), back(1)] : range === "7d" ? [back(6), today]
    : range === "custom" && sp.from && sp.to ? [sp.from, sp.to] : [today, today];
  const inDates = (r: Row) => r.task_date >= from && r.task_date <= to;
  const mine = await rows("(i.assignee_id=? OR (p.cbm_id=? AND i.status='auditflag'))", u.id, u.id);
  const now = Date.now();
  const lists: Record<string, Row[]> = {
    now: mine.filter((r) => inDates(r) && ["current", "upcoming"].includes(r.status)).sort((a, b) => (a.status === "current" ? -1 : 1) - (b.status === "current" ? -1 : 1) || a.window_start_at - b.window_start_at),
    overdue: mine.filter((r) => r.status === "notsub").sort((a, b) => a.late_until_at - b.late_until_at),
    changes: mine.filter((r) => r.status === "changes"),
    flags: mine.filter((r) => r.status === "auditflag"),
    done: mine.filter((r) => inDates(r) && !["current", "upcoming", "notsub", "changes", "auditflag"].includes(r.status)),
  };
  const toItem = (r: Row): MyTask => {
    const open = ["current", "notsub", "changes", "auditflag"].includes(r.status);
    const due = r.status === "notsub" ? `Late window ends in ${fmtDur(r.late_until_at - now)}` :
      r.status === "current" ? `Due by ${r.window_end}${r.source !== "schedule" ? ` (${fmtDateTime(r.window_end_at)})` : ""}` :
      r.status === "upcoming" ? `Opens at ${r.window_start}` : r.status === "changes" ? `Attempt ${r.attempt} of ${r.attempts_allowed} · ${r.last_reason ?? "see flags"}` : "";
    return {
      id: r.id, task: r.task, crit: r.criticality === "high", property: r.property, category: r.category, win: `${r.window_start}–${r.window_end}`, date: r.task_date, dateLabel: fmtDate(r.task_date),
      status: r.status, label: STATUS_LABEL[r.status], pill: STATUS_PILL[r.status], due, dueAt: r.status === "notsub" ? r.late_until_at : r.window_end_at,
      warn: r.status === "notsub" || r.status === "changes", cta: open ? (r.status === "changes" ? "Fix and resubmit" : r.status === "auditflag" ? "Answer flags" : "Start") : null,
    };
  };
  const items = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, l.map(toItem)]));
  return <TasksClient lists={items} tab={tab} range={range === "custom" && !(sp.date || (sp.from && sp.to)) ? "today" : range} from={from} to={to} today={today} views={await viewsFor(u.id, "tasks")} />;
}
