// The task lifecycle end to end through the real server actions: submit, send back, resubmit, pass, audit fail, CBM answers, close.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import * as E from "@/lib/engine";
import { signInAs, ready, one, all, handTask, ADMIN, REVIEWER, AUDITOR } from "./helpers";

before(ready);
const yes = (r: { ok: boolean }) => assert.equal(r.ok, true, JSON.stringify(r));
const status = async (id: number) => (await one<{ status: string }>("SELECT status FROM instances WHERE id=?", id))!.status;

async function freshTask() {
  // An event task at property 1 starts now, assigned to someone at the property.
  const t = { id: await handTask([1]) };
  await one("UPDATE templates SET audit_rate=1, attempts_allowed=3 WHERE id=? RETURNING id", t.id);
  signInAs(ADMIN);
  yes(await A.triggerTask(t.id, 1));
  const i = (await one<{ id: number; assignee_id: number; template_id: number }>("SELECT id, assignee_id, template_id FROM instances WHERE template_id=? ORDER BY id DESC LIMIT 1", t.id))!;
  const items = await E.itemsFor(i.template_id);
  const answers = items.map((it) => ({ itemId: it.id, checked: true, value: it.kind === "yesno" ? "No" : "5", note: "ok", photos: it.photo_required ? ["x.jpg"] : [] }));
  return { ...i, items, answers };
}

test("full lifecycle with rework and audit", async () => {
  const t = await freshTask();
  const prop = (await one<{ lat: number; lng: number }>("SELECT lat, lng FROM properties WHERE id=1"))!;
  signInAs(t.assignee_id);
  yes(await A.submitTask(t.id, t.answers, { lat: prop.lat, lng: prop.lng }));
  assert.equal(await status(t.id), "review");
  // A second click on Submit is refused, not a duplicate.
  assert.equal((await A.submitTask(t.id, t.answers, null)).ok, false);
  assert.equal((await all("SELECT id FROM submissions WHERE instance_id=?", t.id)).length, 1);

  signInAs(REVIEWER);
  yes(await A.reviewTask(t.id, "changes", [{ itemId: t.items[0].id, reason: "Photo unclear", comment: "Retake" }], "", Date.now()));
  assert.equal(await status(t.id), "changes");

  signInAs(t.assignee_id);
  yes(await A.submitTask(t.id, t.answers, { lat: prop.lat, lng: prop.lng }));
  assert.equal(await status(t.id), "resub");

  signInAs(REVIEWER);
  yes(await A.reviewTask(t.id, "pass", [], "", Date.now()));
  assert.equal(await status(t.id), "audit");

  signInAs(AUDITOR);
  yes(await A.auditTask(t.id, "fail", [{ itemId: t.items[0].id, reason: "Item not done", comment: "Not as seen on visit" }], ""));
  assert.equal(await status(t.id), "auditflag");

  const cbm = (await one<{ cbm_id: number }>("SELECT cbm_id FROM properties WHERE id=1"))!.cbm_id;
  const flags = await all<{ id: number }>("SELECT f.id FROM review_flags f JOIN reviews r ON r.id=f.review_id WHERE r.instance_id=? AND r.kind='audit'", t.id);
  signInAs(cbm);
  yes(await A.answerFlags(t.id, Object.fromEntries(flags.map((f) => [f.id, "Redone and checked"]))));
  signInAs(AUDITOR);
  yes(await A.closeFlags(t.id, true));
  assert.equal(await status(t.id), "done");
  const types = (await all<{ type: string }>("SELECT type FROM events WHERE instance_id=? ORDER BY at, id", t.id)).map((e) => e.type);
  for (const want of ["submitted", "changes_requested", "resubmitted", "passed", "audit_failed", "flags_answered", "flags_closed"]) assert.ok(types.includes(want), want);
});

test("P0-7: the server works out the distance; a simulated location is recorded as simulated", async () => {
  const far = await freshTask();
  signInAs(far.assignee_id);
  yes(await A.submitTask(far.id, far.answers, { lat: 28.61, lng: 77.2 })); // Delhi, far from Bangalore
  const s = (await one<{ location_ok: number; distance_m: number; location_src: string }>("SELECT location_ok, distance_m, location_src FROM submissions WHERE instance_id=?", far.id))!;
  assert.equal(s.location_ok, 0);
  assert.ok(s.distance_m > 1_000_000);
  assert.equal(s.location_src, "gps");

  const sim = await freshTask();
  signInAs(sim.assignee_id);
  yes(await A.submitTask(sim.id, sim.answers, "simulated"));
  const s2 = (await one<{ location_ok: number | null; location_src: string }>("SELECT location_ok, location_src FROM submissions WHERE instance_id=?", sim.id))!;
  assert.equal(s2.location_ok, null);
  assert.equal(s2.location_src, "simulated");
  assert.ok(await one("SELECT 1 FROM events WHERE instance_id=? AND type='location_warning'", sim.id));
});

test("a reviewer can pass an item with missing evidence, and the history says so", async () => {
  const t = await freshTask();
  const prop = (await one<{ lat: number; lng: number }>("SELECT lat, lng FROM properties WHERE id=1"))!;
  signInAs(t.assignee_id);
  yes(await A.submitTask(t.id, t.answers.map((a) => ({ ...a, photos: [] })), { lat: prop.lat, lng: prop.lng }));
  signInAs(REVIEWER);
  yes(await A.reviewTask(t.id, "pass", [], "Photo upload was broken", Date.now()));
  assert.equal(await status(t.id), "audit");
  const ev = (await one<{ detail: string }>("SELECT detail FROM events WHERE instance_id=? AND type='passed'", t.id))!;
  assert.match(ev.detail, /accepted without evidence: Area clean/);
});
