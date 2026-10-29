export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function atTime(date: string, hhmm: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n, 12).getTime());
}
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
export function fmtDur(ms: number): string {
  const h = ms / HOUR;
  if (h < 1) return `${Math.max(0, Math.round(ms / 60000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} days`;
}
export function fmtDate(date: string): string {
  return new Date(date + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
