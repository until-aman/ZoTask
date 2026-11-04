"use client";
// A time picker that is always 24-hour (00–23 : 00–55), whatever the browser's locale. Native time inputs show AM/PM in many browsers.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

export function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [h, m] = (value || "00:00").split(":");
  const mins = MINS.includes(m) ? MINS : [...MINS, m].sort();
  return (
    <span className="time24" role="group" aria-label={label}>
      <select value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} aria-label={`${label} hour`}>{HOURS.map((x) => <option key={x}>{x}</option>)}</select>
      <span aria-hidden="true">:</span>
      <select value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)} aria-label={`${label} minutes`}>{mins.map((x) => <option key={x}>{x}</option>)}</select>
    </span>
  );
}

/** Minutes for a task window, kept in step with the end time. */
export const DURATIONS = [15, 20, 30, 40, 45, 60, 90, 120, 180, 240, 360, 480, 600, 720];
