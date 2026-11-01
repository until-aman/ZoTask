// Every gap found in the audit's permission checks, now refused. Property 1 and property 14 have different CBMs and staff.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import { signInAs, ready, at, one, all, ADMIN, REVIEWER } from "./helpers";
import { taskInScope } from "@/lib/auth";

let p1: Awaited<ReturnType<typeof at>>, p14: Awaited<ReturnType<typeof at>>;
before(async () => { await ready(); p1 = await at(1); p14 = await at(14); });

const no = (r: { ok: boolean }) => assert.equal(r.ok, false, JSON.stringify(r));
const yes = (r: { ok: boolean }) => assert.equal(r.ok, true, JSON.stringify(r));

test("P0-2: ground staff and CBMs can't read tasks at other properties", async () => {
  const user = async (id: number) => (await one("SELECT * FROM users WHERE id=?", id))!;
  assert.equal(await taskInScope(await user(p1.ground), p14.task), null);
  assert.equal(await taskInScope(await user(p1.cbm), p14.task), null);
  assert.equal(await taskInScope(await user(p1.ground), p1.task), 1);
  assert.equal(await taskInScope(await user(REVIEWER), p14.task), 14);
  assert.equal(await taskInScope(await user(REVIEWER), Number("abc")), null);
  signInAs(p1.ground);
  assert.deepEqual(await A.getHistory(p14.task), []);
  assert.ok((await A.getHistory(p1.task)).length > 0);
  signInAs(p1.cbm);
  assert.equal(await A.getTaskDetail(p14.task), null);
  assert.ok(await A.getTaskDetail(p1.task));
});

test("P0-3: a CBM can't waive or create tasks at another CBM's property", async () => {
  const open14 = await one<{ id: number }>("SELECT id FROM instances WHERE property_id=14 AND status IN ('upcoming','current','notsub') LIMIT 1");
  const open1 = await one<{ id: number }>("SELECT id FROM instances WHERE property_id=1 AND status IN ('upcoming','current','notsub') LIMIT 1");
  signInAs(p1.cbm);
  no(await A.waiveTask(open14!.id, "test"));
  assert.notEqual((await one<{ status: string }>("SELECT status FROM instances WHERE id=?", open14!.id))!.status, "waived");
  yes(await A.waiveTask(open1!.id, "Property closed for repairs"));
  const ev = await one<{ id: number }>("SELECT t.id FROM templates t JOIN template_properties tp ON tp.template_id=t.id WHERE t.trigger<>'scheduled' AND t.active=1 AND tp.property_id=14 LIMIT 1");
  no(await A.triggerTask(ev!.id, 14));
  const sched = await one<{ id: number }>("SELECT id FROM templates WHERE trigger='scheduled' LIMIT 1");
  signInAs(ADMIN);
  no(await A.triggerTask(sched!.id, 1)); // scheduled tasks can't be started by hand
  yes(await A.triggerTask(ev!.id, 14));
});

test("P0-4: audit answers only reach the flags of that task's latest audit", async () => {
  const flags = await all<{ id: number; instance_id: number; cbm_id: number }>(`SELECT f.id, rv.instance_id, p.cbm_id FROM review_flags f JOIN reviews rv ON rv.id=f.review_id
    JOIN instances i ON i.id=rv.instance_id JOIN properties p ON p.id=i.property_id WHERE i.status='auditflag' AND rv.kind='audit'`);
  const mine = flags[0], other = flags.find((f) => f.instance_id !== mine.instance_id)!;
  const reviewFlag = (await one<{ id: number }>("SELECT f.id FROM review_flags f JOIN reviews rv ON rv.id=f.review_id WHERE rv.kind='review' LIMIT 1"))!;
  const own = flags.filter((f) => f.instance_id === mine.instance_id);
  signInAs(mine.cbm_id);
  no(await A.answerFlags(mine.instance_id, { [other.id]: "not mine" }));
  no(await A.answerFlags(mine.instance_id, { ...Object.fromEntries(own.map((f) => [f.id, "fixed"])), [reviewFlag.id]: "not mine" }));
  assert.equal((await one<{ answer: string | null }>("SELECT answer FROM review_flags WHERE id=?", other.id))!.answer, null);
  assert.notEqual((await one<{ answer: string | null }>("SELECT answer FROM review_flags WHERE id=?", reviewFlag.id))!.answer, "not mine");
  if (own.length > 1) no(await A.answerFlags(mine.instance_id, { [own[0].id]: "only one" }));
  yes(await A.answerFlags(mine.instance_id, Object.fromEntries(own.map((f) => [f.id, "Retrained the HK, photo attached"]))));
  assert.equal((await one<{ status: string }>("SELECT status FROM instances WHERE id=?", mine.instance_id))!.status, "flagans");
});

test("P0-5: reassigning an escalation hands it to the new owner's account", async () => {
  signInAs(ADMIN);
  const r = await A.raiseEscalation({ department: "R&M", title: "Lift stuck", detail: "", priority: "high", propertyIds: [1], ownerName: "Aman Antil", ownerEmail: "", cc: "", due: "", mailSent: false, mailSubject: "", link: "", photos: [], instanceId: null });
  yes(r);
  const rashi = (await one<{ id: number; email: string }>("SELECT id, email FROM users WHERE name='Rashi Renwal'"))!;
  yes(await A.updateEscalation(r.id!, { ownerName: "Rashi Renwal", ownerEmail: rashi.email }));
  assert.equal((await one<{ owner_id: number }>("SELECT owner_id FROM escalations WHERE id=?", r.id))!.owner_id, rashi.id);
  signInAs(rashi.id);
  yes(await A.updateEscalation(r.id!, { note: "Vendor booked" }));
  signInAs(7); // Aman, the old owner, raised nothing here
  no(await A.updateEscalation(r.id!, { status: "done" }));
});

test("P2-5: escalations need a real priority, department, and a closure date that isn't past", async () => {
  signInAs(ADMIN);
  const base = { department: "R&M", title: "Leak", detail: "", priority: "high", propertyIds: [1], ownerName: "R&M team", ownerEmail: "", cc: "", due: "", mailSent: false, mailSubject: "", link: "", photos: [], instanceId: null };
  no(await A.raiseEscalation({ ...base, priority: "zzz" }));
  no(await A.raiseEscalation({ ...base, department: "Nobody" }));
  no(await A.raiseEscalation({ ...base, due: "2001-01-01" }));
  signInAs(p1.cbm);
  no(await A.raiseEscalation({ ...base, propertyIds: [14] }));
  no(await A.raiseEscalation({ ...base, instanceId: p14.task }));
  yes(await A.raiseEscalation(base));
});

test("P1-7: reviews can only be reassigned to a reviewer who didn't submit the task", async () => {
  const t = (await one<{ id: number }>("SELECT id FROM instances WHERE status='review' LIMIT 1"))!;
  signInAs(REVIEWER);
  no(await A.reassignReviewer([t.id], p1.ground));
  no(await A.reassignReviewer([t.id], p1.cbm));
  yes(await A.reassignReviewer([t.id], 3));
  assert.equal((await one<{ reviewer_id: number }>("SELECT reviewer_id FROM instances WHERE id=?", t.id))!.reviewer_id, 3);
});

test("P2-4: ground staff can't send reminders; CBMs only for their own properties", async () => {
  const t1 = (await one<{ id: number }>("SELECT id FROM instances WHERE property_id=1 AND status='review' LIMIT 1"))!;
  const t14 = (await one<{ id: number }>("SELECT id FROM instances WHERE property_id=14 AND status='review' LIMIT 1"))!;
  signInAs(p1.ground);
  no(await A.remindTasks([t1.id]));
  signInAs(p1.cbm);
  no(await A.remindTasks([t14.id]));
  yes(await A.remindTasks([t1.id]));
});
