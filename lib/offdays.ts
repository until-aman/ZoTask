// Reviewer week offs. The central team doesn't review on Sundays, some Saturdays and holidays, so:
// - review and audit time limits only count working days (the clock pauses on off days);
// - a task submitted on an off day is marked for the Weekend list: critical, auto-flagged and a random sample must be
//   checked, the rest close by themselves a while after the team is back, and can be pulled back for a few days after.
// CBMs see none of this: their task shows "To Review" and later "Done", exactly as on a working day.
import { DAY, addDays, dayStart, isoDate, weekday } from "./time";

export type OffCfg = {
  /** Switch for the whole feature (on by default: Sundays and 2nd and 3rd Saturdays off). */
  on: boolean;
  sundays: boolean;
  /** Which Saturdays of the month are off: 1 = first … 5 = fifth. */
  saturdays: number[];
  holidays: { date: string; name: string }[];
  /** Share of the remaining off-day tasks picked at random for a check, 0–1. */
  sample: number;
  /** Hours after the team is back that unpicked tasks close by themselves. */
  closeAfterH: number;
  /** Days after closing that a reviewer can still pull an auto-closed task back for review. */
  pullbackDays: number;
};
export const DEFAULT_OFF: OffCfg = { on: true, sundays: true, saturdays: [2, 3], holidays: [], sample: 0.2, closeAfterH: 48, pullbackDays: 7 };

export function normOff(v: Partial<OffCfg> | null | undefined): OffCfg {
  const c = { ...DEFAULT_OFF, ...(v ?? {}) };
  return {
    on: !!c.on, sundays: !!c.sundays,
    saturdays: [...new Set((c.saturdays ?? []).map(Number).filter((n) => n >= 1 && n <= 5))].sort(),
    holidays: (c.holidays ?? []).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h?.date ?? "")).map((h) => ({ date: h.date, name: String(h.name ?? "").slice(0, 60) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    sample: Math.min(1, Math.max(0, Number(c.sample) || 0)),
    closeAfterH: Math.min(240, Math.max(1, Math.round(Number(c.closeAfterH) || DEFAULT_OFF.closeAfterH))),
    pullbackDays: Math.min(60, Math.max(0, Math.round(Number(c.pullbackDays) || 0))),
  };
}

/** Is this IST date a day off for the reviewers? */
export function isOff(c: OffCfg, date: string): boolean {
  if (!c.on) return false;
  const w = weekday(date);
  if (w === 0 && c.sundays) return true;
  if (w === 6 && c.saturdays.includes(Math.ceil(Number(date.slice(8, 10)) / 7))) return true;
  return c.holidays.some((h) => h.date === date);
}
/** Why a date is off, for labels ("Sunday", "2nd Saturday", "Diwali"). */
export function offReason(c: OffCfg, date: string): string | null {
  if (!isOff(c, date)) return null;
  const h = c.holidays.find((x) => x.date === date);
  if (h) return h.name || "Holiday";
  if (weekday(date) === 0) return "Sunday";
  const n = Math.ceil(Number(date.slice(8, 10)) / 7);
  return `${n}${["st", "nd", "rd", "th", "th"][n - 1]} Saturday`;
}

/** The moment reviewers are next at work: `ms` itself on a working day, else the start of the next working day. */
export function backAt(c: OffCfg, ms: number): number {
  let d = isoDate(ms);
  if (!isOff(c, d)) return ms;
  for (let i = 0; i < 60 && isOff(c, d); i++) d = addDays(d, 1);
  return dayStart(d);
}

/** Time between two moments that falls on working days (off days don't count). */
export function workMs(c: OffCfg, from: number, to: number): number {
  if (to <= from) return 0;
  if (!c.on) return to - from;
  let total = 0, d = isoDate(from);
  for (let i = 0; i < 1000; i++) {
    const s = dayStart(d), e = s + DAY;
    if (s >= to) break;
    if (!isOff(c, d)) total += Math.min(e, to) - Math.max(s, from);
    d = addDays(d, 1);
  }
  return total;
}

/** The moment `ms` of working time has passed after `from` (off days skipped): a time limit's deadline. */
export function addWork(c: OffCfg, from: number, ms: number): number {
  if (!c.on) return from + ms;
  let left = ms, t = from, d = isoDate(from);
  for (let i = 0; i < 1000; i++) {
    const e = dayStart(d) + DAY;
    if (!isOff(c, d)) { const take = Math.min(left, e - t); left -= take; t += take; if (left <= 0) return t; }
    d = addDays(d, 1); t = dayStart(d);
  }
  return t;
}

/** When unpicked off-day tasks close by themselves: closeAfterH of working time after the team is back
 *  (a holiday in between doesn't eat into the reviewers' time to look). */
export const autoCloseAt = (c: OffCfg, submittedAt: number) => addWork(c, backAt(c, submittedAt), c.closeAfterH * 3600_000);

/** Statuses waiting on the central team, whose clock pauses on off days. */
export const CENTRAL_ST = ["review", "resub", "audit", "flagans"];
/** How long a task has waited in its current state, for time-limit checks. Central-team waits skip off days;
 *  tasks that will close by themselves never count as late. */
export function waitMs(c: OffCfg, r: { status: string; status_since: number; wk?: string | null }, now: number): number {
  if (!CENTRAL_ST.includes(r.status)) return now - r.status_since;
  if (r.wk === "auto" && (r.status === "review" || r.status === "resub")) return 0;
  return workMs(c, r.status_since, now);
}

// The settings are read often (every page and every time-limit check), so they're cached for a short while.
type G = { __zotaskOff?: { at: number; c: OffCfg } };
const g = globalThis as G;
/** The settings as last loaded (defaults before the first load). */
export const offCfg = (): OffCfg => g.__zotaskOff?.c ?? DEFAULT_OFF;
export function setOffCache(c: OffCfg) { g.__zotaskOff = { at: Date.now(), c }; }
export const offCacheFresh = () => !!g.__zotaskOff && Date.now() - g.__zotaskOff.at < 30_000;
