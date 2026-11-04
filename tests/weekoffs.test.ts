// Reviewer week offs: off days, paused time limits, the weekend pick, closing by itself, pull back, and what CBMs see.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import * as E from "@/lib/engine";
import { saveOffDays } from "@/app/admin-actions";
import { DEFAULT_OFF, addWork, autoCloseAt, backAt, isOff, normOff, offReason, workMs, type OffCfg } from "@/lib/offdays";
import { eventsFor } from "@/lib/queries";
import { HOUR, atTime } from "@/lib/time";
import { signInAs, ready, one, handTask, ADMIN, REVIEWER } from "./helpers";
import { run } from "@/lib/db";

before(ready);
const yes = (r: { ok: boolean }) => assert.equal(r.ok, true, JSON.stringify(r));
const C: OffCfg = { ...DEFAULT_OFF, on: true, sundays: true, saturdays: [2, 3], holidays: [{ date: "2026-11-09", name: "Festival" }] };

test("which days are off", () => {
  assert.equal(isOff(C, "2026-11-01"), true);            // Sunday
  assert.equal(isOff(C, "2026-11-07"), false);           // 1st Saturday
  assert.equal(isOff(C, "2026-11-14"), true);            // 2nd Saturday
  assert.equal(isOff(C, "2026-11-21"), true);            // 3rd Saturday
  assert.equal(isOff(C, "2026-11-28"), false);           // 4th Saturday
  assert.equal(isOff(C, "2026-11-09"), true);            // holiday (a Monday)
  assert.equal(isOff(C, "2026-11-10"), false);
  assert.equal(offReason(C, "2026-11-14"), "2nd Saturday");
  assert.equal(offReason(C, "2026-11-09"), "Festival");
  assert.equal(isOff({ ...C, on: false }, "2026-11-01"), false);
  assert.deepEqual(normOff({ saturdays: [9, 2, 2] as number[], sample: 5 }).saturdays, [2]);
  assert.equal(normOff({ sample: 5 }).sample, 1);
});

test("time limits only count working days", () => {
  // Friday 13 Nov 18:00 IST → Monday 16 Nov 10:00: Sat 14 (2nd) and Sun 15 are off, so only 6h Friday + 10h Monday count.
  const fri = atTime("2026-11-13", "18:00"), mon = atTime("2026-11-16", "10:00");
  assert.equal(workMs(C, fri, mon), 16 * HOUR);
  // A 24h limit from Friday 18:00 ends Monday 18:00.
  assert.equal(addWork(C, fri, 24 * HOUR), atTime("2026-11-16", "18:00"));
  // Submitted Sunday: the team is back Monday 00:00, and unpicked tasks close 48h later.
  const sun = atTime("2026-11-15", "11:00");
  assert.equal(backAt(C, sun), atTime("2026-11-16", "00:00"));
  assert.equal(autoCloseAt(C, sun), atTime("2026-11-18", "00:00"));
  // Saturday 14 → back Monday 16 (Sunday is off too); 1st Saturday is a working day.
  assert.equal(backAt(C, atTime("2026-11-14", "09:00")), atTime("2026-11-16", "00:00"));
  assert.equal(backAt(C, atTime("2026-11-07", "09:00")), atTime("2026-11-07", "09:00"));
});

async function started(critical = false) {
  const tid = await handTask([1]);
  await run("UPDATE templates SET audit_rate=0, criticality=?, review_sla_h=24 WHERE id=?", critical ? "high" : "normal", tid);
  signInAs(ADMIN);
  yes(await A.triggerTask(tid, 1));
  const i = (await one<{ id: number; assignee_id: number; template_id: number }>("SELECT id, assignee_id, template_id FROM instances WHERE template_id=? ORDER BY id DESC LIMIT 1", tid))!;
  const items = await E.itemsFor(i.template_id);
  const answers = items.map((it) => ({ itemId: it.id, checked: true, value: it.kind === "yesno" ? "No" : "5", note: "ok", photos: it.photo_required ? ["x.jpg"] : [] }));
  // Pretend the window was long ago so "late" doesn't flag it; the submission lands on a Sunday.
  await run("UPDATE instances SET window_start_at=?, window_end_at=?, late_until_at=? WHERE id=?",
    atTime("2026-11-15", "00:00"), atTime("2026-11-15", "23:59"), atTime("2026-11-16", "23:59"), i.id);
  return { ...i, answers };
}
const SUNDAY = atTime("2026-11-15", "11:00");
const inst = (id: number) => one<{ status: string; wk: string | null; wk_why: string | null; wk_closed_at: number | null; first_decision: string | null }>(
  "SELECT status, wk, wk_why, wk_closed_at, first_decision FROM instances WHERE id=?", id);

test("admins save the week offs", async () => {
  signInAs(REVIEWER);
  assert.equal((await saveOffDays({ ...C, sample: 0 })).ok, false);
  signInAs(ADMIN);
  yes(await saveOffDays({ ...C, sample: 0 }));
  assert.equal((await E.loadOff(true)).sample, 0);
});

test("a plain Sunday submission is optional, closes by itself, and can be pulled back", async () => {
  const t = await started();
  await E.submit(t.id, t.assignee_id, t.answers, { ok: true, distance: 0 }, SUNDAY);
  let i = (await inst(t.id))!;
  assert.equal(i.status, "review");
  assert.equal(i.wk, "auto", i.wk_why ?? "");
  // Not before the team has been back 48h…
  assert.equal(await E.autoCloseWeekend(atTime("2026-11-17", "23:00")), 0);
  // …then it closes as a pass, noted internally.
  assert.ok((await E.autoCloseWeekend(atTime("2026-11-18", "01:00"))) >= 1);
  i = (await inst(t.id))!;
  assert.equal(i.status, "done");
  assert.equal(i.first_decision, "pass");
  assert.equal(i.wk_closed_at, atTime("2026-11-18", "00:00"));
  assert.ok(await one("SELECT 1 FROM events WHERE instance_id=? AND type='weekend_closed'", t.id));

  // The CBM's history shows a normal pass signed by the review team, and no sampling note.
  const cbm = await eventsFor(t.id, "cbm");
  assert.equal(cbm.some((e) => e.type === "weekend_closed"), false);
  assert.equal(cbm.find((e) => e.type === "passed")?.actor, "Review team");
  assert.equal(cbm.find((e) => e.type === "passed")?.detail, "Verified");
  assert.ok((await eventsFor(t.id, "reviewer")).some((e) => e.type === "weekend_closed"));

  // Pulled back within 7 days: back to review, now a must-check.
  await assert.rejects(E.pullBack(t.id, REVIEWER, i.wk_closed_at! + 8 * 24 * HOUR));
  await E.pullBack(t.id, REVIEWER, i.wk_closed_at! + 2 * 24 * HOUR);
  i = (await inst(t.id))!;
  assert.equal(i.status, "review");
  assert.equal(i.wk, "must");
  assert.equal(i.wk_why, "Pulled back");
  // A must-check never closes by itself.
  await E.autoCloseWeekend(atTime("2026-12-31", "00:00"));
  assert.equal((await inst(t.id))!.status, "review");
});

test("critical and flagged Sunday submissions must be checked; weekday ones aren't marked", async () => {
  const c = await started(true);
  await E.submit(c.id, c.assignee_id, c.answers, { ok: true, distance: 0 }, SUNDAY);
  assert.equal((await inst(c.id))!.wk, "must");
  assert.match((await inst(c.id))!.wk_why!, /Critical/);

  const m = await started();
  const noPhoto = m.answers.map((a) => ({ ...a, photos: [] }));
  await E.submit(m.id, m.assignee_id, noPhoto, { ok: true, distance: 0 }, SUNDAY);
  assert.match((await inst(m.id))!.wk_why!, /Missing evidence/);

  const late = await started();
  await E.submit(late.id, late.assignee_id, late.answers, { ok: true, distance: 0 }, atTime("2026-11-16", "09:00") + 0);
  assert.equal((await inst(late.id))!.wk, null, "Monday is a working day");
});

test("a reviewer can still check an optional task before it closes", async () => {
  const t = await started();
  await E.submit(t.id, t.assignee_id, t.answers, { ok: true, distance: 0 }, SUNDAY);
  signInAs(REVIEWER);
  await E.reviewDecision(t.id, REVIEWER, "pass", [], "", atTime("2026-11-16", "10:00"));
  assert.equal((await inst(t.id))!.status, "done");
  assert.equal((await inst(t.id))!.wk_closed_at, null);
  // The check's deadline skipped Sunday: submitted Sunday 11:00 with 24h → due Tuesday 00:00.
  const due = (await one<{ due_at: number }>("SELECT due_at FROM reviews WHERE instance_id=? ORDER BY id DESC LIMIT 1", t.id))!.due_at;
  assert.equal(due, atTime("2026-11-17", "00:00"));
});
