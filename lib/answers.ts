// Answer options for checklist items: "Options" items (kind "choice") carry their own list, e.g. Yes / No / N/A.
// The older "yesno" kind is the same thing with Yes and No.
export const DEFAULT_OPTIONS = ["Yes", "No"];

/** Clean an options list: trimmed, no blanks, no repeats (ignoring case), at most 10 of 40 characters each. */
export function cleanOptions(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? (() => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } })() : [];
  const out: string[] = [];
  for (const o of raw) {
    const s = String(o ?? "").trim().slice(0, 40);
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, 10);
}

/** The choices a CBM picks from for this item, or null when the item isn't a pick-one question. */
export function choicesFor(it: { kind: string; options?: unknown }): string[] | null {
  if (it.kind === "yesno") return DEFAULT_OPTIONS;
  if (it.kind !== "choice") return null;
  const o = cleanOptions(it.options);
  return o.length ? o : DEFAULT_OPTIONS;
}

// What a submission must contain. Checked on the task form as the person types and again on the server, so a task
// can't be sent with a compulsory photo or note missing, an unanswered question, or a negative number.
export type RuleItem = { id: number; kind: string; photo_required?: number | boolean | null; note_required?: number | boolean | null; options?: unknown };
export type AnswerLike = { checked?: boolean; value?: string | null; note?: string | null; photos?: string[] | null; reply?: string | null };
export const MAX_NUMBER = 1_000_000;

/** Removes a minus sign and anything that isn't part of a number, as the person types. */
export function nonNegative(v: string, whole = false): string {
  const s = v.replace(/[^\d.]/g, "");
  if (whole) return s.replace(/\./g, "");
  const [a, ...b] = s.split(".");
  return b.length ? `${a}.${b.join("")}` : a;
}

/** The first thing missing or wrong in one item's answer, in plain words, or null when it's complete. */
export function answerIssue(it: RuleItem, a: AnswerLike | undefined, flagged = false): string | null {
  const v = (a?.value ?? "").trim(), note = (a?.note ?? "").trim();
  if (it.kind === "check") {
    if (!a?.checked && !note) return "Not done? Tick it, or add a note saying why";
  } else if (it.kind === "number" || it.kind === "count") {
    if (!v) return "Enter a number";
    const n = Number(v);
    if (!Number.isFinite(n)) return "Enter a number";
    if (n < 0) return "Numbers can't be negative";
    if (it.kind === "count" && !Number.isInteger(n)) return "Enter a whole number";
    if (n > MAX_NUMBER) return "That number is too large";
  } else if (choicesFor(it)) {
    if (!v) return "Pick an answer";
    if (!choicesFor(it)!.includes(v)) return "Pick one of the options";
  } else if (!v) return "Write an answer";
  if (it.photo_required && !(a?.photos ?? []).length) return "Add a photo (compulsory)";
  if (it.note_required && !note) return "Add a note (compulsory)";
  if (flagged && !(a?.reply ?? "").trim()) return "Reply to the reviewer's flag";
  return null;
}
