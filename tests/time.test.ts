// P0-6: schedules and dates are IST whatever zone the machine runs in (tests run with TZ=UTC, like Vercel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { atTime, isoDate, addDays, weekday, fmtDate, fmtDateTime, dayStart } from "@/lib/time";

test("a 10:00 window opens at 10:00 IST, which is 04:30 UTC", () => {
  assert.equal(new Date(atTime("2026-11-01", "10:00")).toISOString(), "2026-11-01T04:30:00.000Z");
  assert.equal(fmtDateTime(atTime("2026-11-01", "10:00")), "1 Nov, 10:00");
});

test("the IST day starts at 18:30 UTC the evening before", () => {
  assert.equal(isoDate(Date.parse("2026-11-01T18:29:00Z")), "2026-11-01");
  assert.equal(isoDate(Date.parse("2026-11-01T18:30:00Z")), "2026-11-02");
  assert.equal(new Date(dayStart("2026-11-02")).toISOString(), "2026-11-01T18:30:00.000Z");
});

test("calendar helpers", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekday("2026-11-01"), 0); // a Sunday
  assert.equal(fmtDate("2026-11-01"), "1 Nov");
});
