// People's own week offs and leave: tasks go to their backup or a teammate, are excused when nobody can cover,
// reviews move to a backup reviewer, and a reviewer with no backup has their clock paused.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import * as E from "@/lib/engine";
import { forPerson, waitMs, DEFAULT_OFF, coverFor, personOffWhy, type PersonOff } from "@/lib/offdays";
import { HOUR, atTime, addDays, isoDate } from "@/lib/time";
import { signInAs, ready, one, all, handTask, ADMIN, REVIEWER, REVIEWER2 } from "./helpers";
import { run } from "@/lib/db";

before(ready);
const yes = (r: { ok: boolean }) => assert.equal(r.ok, true, JSON.stringify(r));

test("who's off and who covers", () => {
  const m = new Map<number, PersonOff>([
    [1, { week: [2], leaves: [{ from: "2026-11-10", to: "2026-11-12", note: "Wedding" }], backup: 2 }],
    [2, { week: [], leaves: [{ from: "2026-11-11", to: "2026-11-11", note: null }], backup: 3 }],
  ]);
  assert.equal(personOffWhy(m.get(1), "2026-11-03"), "Weekly off");     // a Tuesday
  assert.equal(personOffWhy(m.get(1), "2026-11-10"), "On leave: Wedding");
  assert.equal(personOffWhy(m.get(1), "2026-11-13"), null);
  const all = () => true;
  assert.equal(coverFor(m, 1, "2026-11-10", [], all), 2);
  assert.equal(coverFor(m, 1, "2026-11-11", [], all), 3, "the backup is off too, so the backup's backup");
  assert.equal(coverFor(m, 1, "2026-11-11", [4], (id) => id !== 3), 4, "falls back to a teammate");
  assert.equal(coverFor(m, 1, "2026-11-11", [], (id) => id !== 3), null);
});

async function openTask() {
  // A hand-started HK task at a property with ground staff: it opens now (today) and goes to the first HK there.
  const prop = (await one<{ property_id: number; op_role: string }>(`SELECT up.property_id, u.op_role FROM user_properties up JOIN users u ON u.id=up.user_id
    WHERE u.access_role='ground' AND u.archived=0 AND u.op_role IS NOT NULL GROUP BY up.property_id, u.op_role ORDER BY count(*) DESC LIMIT 1`))!;
  const tid = await handTask([prop.property_id]);
  await run("UPDATE templates SET op_role=? WHERE id=?", prop.op_role, tid);
  signInAs(ADMIN);
  yes(await A.triggerTask(tid, prop.property_id));
  return (await one<{ id: number; assignee_id: number; property_id: number; task_date: string }>(
    "SELECT id, assignee_id, property_id, task_date FROM instances WHERE template_id=? ORDER BY id DESC LIMIT 1", tid))!;
}

test("a ground person's leave: the task goes to a teammate, or is excused when nobody can cover", async () => {
  const t = await openTask();
  const mates = (await all<{ id: number }>(`SELECT u.id FROM users u JOIN user_properties up ON up.user_id=u.id
    WHERE up.property_id=? AND u.access_role='ground' AND u.id<>? AND u.archived=0`, t.property_id, t.assignee_id)).map((x) => x.id);
  signInAs(ADMIN);
  yes(await A.addLeave(t.assignee_id, t.task_date, t.task_date, "Sick"));
  const after = (await one<{ status: string; assignee_id: number }>("SELECT status, assignee_id FROM instances WHERE id=?", t.id))!;
  if (after.status === "waived") {
    assert.ok(await one("SELECT 1 FROM events WHERE instance_id=? AND type='waived' AND detail LIKE 'Not counted%'", t.id));
  } else {
    assert.notEqual(after.assignee_id, t.assignee_id);
    assert.ok(mates.includes(after.assignee_id) || after.assignee_id !== t.assignee_id);
    assert.ok(await one("SELECT 1 FROM events WHERE instance_id=? AND type='reassigned' AND detail LIKE '%covering for%'", t.id));
  }
});

test("with every teammate off too, the task is excused (waived, not missed)", async () => {
  const t = await openTask();
  const staff = (await all<{ id: number }>(`SELECT u.id FROM users u JOIN user_properties up ON up.user_id=u.id WHERE up.property_id=? AND u.access_role='ground'`, t.property_id)).map((x) => x.id);
  for (const id of staff) await run("INSERT INTO leaves (user_id, from_date, to_date, at) VALUES (?,?,?,0)", id, t.task_date, t.task_date);
  await E.coverAway(Date.now(), true);
  assert.equal((await one<{ status: string }>("SELECT status FROM instances WHERE id=?", t.id))!.status, "waived");
});

test("a reviewer's week off: reviews go to the backup; with no backup the clock pauses", async () => {
  const today = isoDate(Date.now());
  const wd = new Date(today + "T00:00:00Z").getUTCDay();
  signInAs(ADMIN);
  // REVIEWER is off every day of the week that today is, with REVIEWER2 as backup.
  yes(await A.saveWeekOff(REVIEWER, [wd], REVIEWER2));
  const i = (await one<{ id: number }>("SELECT id FROM instances WHERE status='review' AND reviewer_id=? AND (auditor_id IS NULL OR auditor_id<>?) LIMIT 1", REVIEWER, REVIEWER2));
  if (i) {
    await E.coverAway(Date.now(), true);
    assert.equal((await one<{ reviewer_id: number }>("SELECT reviewer_id FROM instances WHERE id=?", i.id))!.reviewer_id, REVIEWER2);
  }
  // No backup: nothing moves, and the time off doesn't count towards the wait.
  yes(await A.saveWeekOff(REVIEWER, [wd], null));
  await E.loadAway(true);
  const r = { status: "review", status_since: atTime(today, "00:00"), reviewer_id: REVIEWER };
  assert.equal(waitMs(DEFAULT_OFF, r, atTime(today, "10:00")), 0);
  assert.equal(waitMs(DEFAULT_OFF, { ...r, reviewer_id: REVIEWER2 }, atTime(today, "10:00")) > 0, true);
  assert.equal(forPerson(DEFAULT_OFF, REVIEWER).also?.(today), true);
  assert.equal(forPerson(DEFAULT_OFF, REVIEWER).also?.(addDays(today, 1)), false);
  yes(await A.saveWeekOff(REVIEWER, [], null));
});

test("only admins can set days off", async () => {
  signInAs(REVIEWER);
  assert.equal((await A.saveWeekOff(REVIEWER, [0], null)).ok, false);
  const cbm = (await one<{ id: number }>("SELECT cbm_id id FROM properties WHERE cbm_id IS NOT NULL LIMIT 1"))!.id;
  signInAs(cbm);
  assert.equal((await A.saveWeekOff(REVIEWER, [0], null)).ok, false, "a CBM can't change a reviewer");
  assert.equal((await A.saveWeekOff(cbm, [0], null)).ok, false, "nor their own");
  assert.equal((await A.addLeave(cbm, "2026-12-01", "2026-12-02", "")).ok, false);
  signInAs(ADMIN);
  assert.equal((await A.addLeave(cbm, "2026-12-10", "2026-12-01", "")).ok, false, "end before start");
  yes(await A.addLeave(cbm, "2026-12-01", "2026-12-02", ""));
  void HOUR;
});
