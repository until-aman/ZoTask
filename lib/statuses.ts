// Status names and pill colours, safe to import from client components.
export const STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming", current: "Current", notsub: "Not Submitted", missed: "Missed", waived: "Waived",
  review: "To Review", resub: "Resubmitted", changes: "Changes Required", audit: "To Audit", auditflag: "Audit Flags",
  flagans: "Flag Answers", done: "Done", notrect: "Not rectified",
};
export const STATUS_PILL: Record<string, string> = {
  upcoming: "", current: "b", notsub: "a", missed: "r", waived: "", review: "b", resub: "b", changes: "a",
  audit: "p", auditflag: "r", flagans: "p", done: "g", notrect: "r",
};

/** History event names and pill colours, shared by the task history and the "Last action" column. */
export const EVENT_LABEL: Record<string, [string, string]> = {
  created: ["Task created", ""], started: ["Started", "b"], triggered: ["Triggered", "b"], window_closed: ["Window closed", "a"], missed: ["Missed", "r"],
  submitted: ["Submitted", "b"], resubmitted: ["Resubmitted", "b"], changes_requested: ["Changes requested", "r"], passed: ["Passed", "g"],
  audit_passed: ["Audit passed", "g"], audit_failed: ["Audit failed", "r"], flags_answered: ["Audit flags answered", "b"],
  flags_closed: ["Audit flags closed", "g"], flags_reopened: ["Flag answers sent back", "r"], reopened: ["Reopened", "a"],
  waived: ["Waived", ""], reminder: ["Reminder", "a"], reassigned: ["Reassigned", ""], location_warning: ["Location warning", "r"],
  acknowledged: ["Acknowledged", ""], weekend_closed: ["Closed by weekend sampling", ""], escalated: ["Escalated", "r"], escalation_raised: ["Escalation raised", "r"],
};
/** Events that move a task along; reminders, warnings and escalations don't count as its last action. */
export const ACTION_EVENTS = ["created", "triggered", "started", "window_closed", "missed", "submitted", "resubmitted", "changes_requested", "passed",
  "audit_passed", "audit_failed", "flags_answered", "flags_closed", "flags_reopened", "reopened", "waived", "done"];
export const actionLabel = (type: string | null) => (type ? EVENT_LABEL[type]?.[0] ?? type.replace(/_/g, " ") : "Task created");
