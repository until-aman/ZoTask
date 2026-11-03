import { fmtDateTime, fmtDur } from "@/lib/time";
import { EVENT_LABEL } from "@/lib/statuses";

const LABEL = EVENT_LABEL;

/** Task history with the time spent between each step. */
export default function Timeline({ events }: { events: { id: number; at: number; type: string; detail: string; actor: string | null }[] }) {
  return (
    <ul className="tl">
      {events.map((e, ix) => {
        const [label, cls] = LABEL[e.type] ?? [e.type, ""];
        const gap = ix > 0 ? e.at - events[ix - 1].at : 0;
        return (
          <li key={e.id} className={cls}>
            {gap > 60000 && <span className="dur">+{fmtDur(gap)} · </span>}
            {label}{e.actor ? ` by ${e.actor}` : ""}
            <small>{fmtDateTime(e.at)}{e.detail ? ` · ${e.detail}` : ""}</small>
          </li>
        );
      })}
    </ul>
  );
}
