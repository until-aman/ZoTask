import { fmtDateTime, fmtDur } from "@/lib/time";

const LABEL: Record<string, [string, string]> = {
  created: ["Task created", ""], triggered: ["Triggered", "b"], window_closed: ["Window closed", "a"], missed: ["Missed", "r"],
  submitted: ["Submitted", "b"], resubmitted: ["Resubmitted", "b"], changes_requested: ["Changes requested", "r"], passed: ["Passed", "g"],
  audit_passed: ["Audit passed", "g"], audit_failed: ["Audit failed", "r"], flags_answered: ["Audit flags answered", "b"],
  flags_closed: ["Audit flags closed", "g"], flags_reopened: ["Flag answers sent back", "r"], reopened: ["Reopened", "a"],
  waived: ["Waived", ""], reminder: ["Reminder", "a"], reassigned: ["Reassigned", ""], location_warning: ["Location warning", "r"],
  acknowledged: ["Acknowledged", ""], escalated: ["Escalated", "r"],
};

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
