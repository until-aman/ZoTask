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
