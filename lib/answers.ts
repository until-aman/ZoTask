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
