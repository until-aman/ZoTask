// All dates and times are India Standard Time, whatever time zone the server or browser runs in.
// Vercel's servers run on UTC, so relying on the machine's zone would open a 10:00 window at 15:30 IST.
// India has no daylight saving, so IST is always UTC+05:30.
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
export const TIME_ZONE = "Asia/Kolkata";
const OFFSET = 330 * 60_000;

/** The IST calendar date of a moment, as YYYY-MM-DD. */
export function isoDate(ms: number): string {
  return new Date(ms + OFFSET).toISOString().slice(0, 10);
}
/** The moment a date and HH:MM happen in IST. */
export function atTime(date: string, hhmm: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - OFFSET;
}
/** Start of an IST day. */
export const dayStart = (date: string) => atTime(date, "00:00");
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function fmtDur(ms: number): string {
  const h = ms / HOUR;
  if (h < 1) return `${Math.max(0, Math.round(ms / 60000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} days`;
}
type Opts = Intl.DateTimeFormatOptions;
/** A moment, formatted in IST (same text on the server and in any browser). */
export const fmtAt = (ms: number, o: Opts) => new Date(ms).toLocaleString("en-GB", { ...o, timeZone: TIME_ZONE });
/** A YYYY-MM-DD date, e.g. "4 Oct". */
export function fmtDate(date: string, o: Opts = { day: "numeric", month: "short" }): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
}
export function fmtDateTime(ms: number): string {
  return fmtAt(ms, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export const fmtTime = (ms: number) => fmtAt(ms, { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (ms: number) => fmtAt(ms, { day: "numeric", month: "short" });
