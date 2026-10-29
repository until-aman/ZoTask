import Link from "next/link";
import { boot } from "@/lib/boot";
import { rows, STATUS_LABEL, STATUS_PILL, Row } from "@/lib/queries";
import { isoDate, fmtDate, fmtDur, fmtDateTime } from "@/lib/time";

const TABS: [string, string][] = [["now", "Current and upcoming"], ["overdue", "Overdue"], ["changes", "Changes required"], ["flags", "Audit flags"], ["done", "Completed"]];

export default async function MyTasks({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const u = await boot();
  const sp = await searchParams;
  const tab = sp.tab ?? "now";
  const date = sp.date ?? isoDate(Date.now());
  const mine = rows("(i.assignee_id=? OR (p.cbm_id=? AND i.status='auditflag'))", u.id, u.id);
  const now = Date.now();
  const lists: Record<string, Row[]> = {
    now: mine.filter((r) => r.task_date === date && ["current", "upcoming"].includes(r.status)).sort((a, b) => (a.status === "current" ? -1 : 1) - (b.status === "current" ? -1 : 1) || a.window_start_at - b.window_start_at),
    overdue: mine.filter((r) => r.status === "notsub").sort((a, b) => a.late_until_at - b.late_until_at),
    changes: mine.filter((r) => r.status === "changes"),
    flags: mine.filter((r) => r.status === "auditflag"),
    done: mine.filter((r) => r.task_date === date && !["current", "upcoming", "notsub", "changes", "auditflag"].includes(r.status)),
  };
  const list = lists[tab] ?? [];
  return (
    <div className="page narrow">
      <div className="row2">
        <div>
          <h1>My Tasks</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>{lists.overdue.length + lists.changes.length + lists.flags.length > 0
            ? <b style={{ color: "var(--red)" }}>{lists.overdue.length} overdue · {lists.changes.length} to fix{lists.flags.length ? ` · ${lists.flags.length} audit flags to answer` : ""}</b>
            : "Nothing overdue. Nice."}</p>
        </div>
        <span className="spacer" />
        <form className="row2">
          <input type="hidden" name="tab" value={tab} />
          <input type="date" name="date" defaultValue={date} aria-label="Date" />
          <button className="btn sm">Go</button>
        </form>
      </div>
      <div className="seg" role="tablist" style={{ width: "fit-content", maxWidth: "100%", overflowX: "auto" }}>
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/tasks?tab=${k}&date=${date}`} aria-pressed={tab === k}>{l} ({lists[k].length})</Link>
        ))}
      </div>
      {!list.length && <div className="card empty"><b>Nothing here</b>{tab === "now" ? `No open tasks on ${fmtDate(date)}.` : "You're all caught up."}</div>}
      <div className="grid">
        {list.map((r) => {
          const open = ["current", "notsub", "changes", "auditflag"].includes(r.status);
          const due = r.status === "notsub" ? `Late window ends in ${fmtDur(r.late_until_at - now)}` :
            r.status === "current" ? `Due by ${r.window_end}${r.source !== "schedule" ? ` (${fmtDateTime(r.window_end_at)})` : ""}` :
            r.status === "upcoming" ? `Opens at ${r.window_start}` : r.status === "changes" ? `Attempt ${r.attempt} of ${r.attempts_allowed} · ${r.last_reason ?? "see flags"}` : "";
          return (
            <Link key={r.id} href={`/tasks/${r.id}`} className="task">
              <div style={{ minWidth: 0 }}>
                <div className="tname">{r.task}{r.criticality === "high" && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</div>
                <div className="tsub">{r.property} · {r.window_start}–{r.window_end} · {fmtDate(r.task_date)}</div>
              </div>
              <span className={`pill ${STATUS_PILL[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              {due && <div className={`small ${r.status === "notsub" || r.status === "changes" ? "warn" : "muted"}`}>{due}</div>}
              {open && <span className="btn sm primary" style={{ justifySelf: "end" }}>{r.status === "changes" ? "Fix and resubmit" : r.status === "auditflag" ? "Answer flags" : "Start"}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
