// The task lifecycle end to end through the real server actions: submit, send back, resubmit, pass, audit fail, CBM answers, close.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import * as E from "@/lib/engine";
import { signInAs, ready, one, all, handTask, ADMIN, REVIEWER, AUDITOR } from "./helpers";

before(ready);
const yes = (r: { ok: boolean }) => assert.equal(r.ok, true, JSON.stringify(r));
const status = async (id: number) => (await one<{ status: string }>("SELECT status FROM instances WHERE id=?", id))!.status;

async function newTask() {
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
/** A fresh task the assignee has already started (tasks have Start/Stop on by default). */
async function freshTask() {
  const t = await newTask();
  await one("INSERT INTO events (instance_id, at, actor_id, type, detail) VALUES (?,?,?,'started','Started the task') RETURNING id", t.id, Date.now(), t.assignee_id);
  return t;
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
  // The flagged item needs a reply before the task can go back.
  assert.equal((await A.submitTask(t.id, t.answers, { lat: prop.lat, lng: prop.lng })).ok, false);
  yes(await A.submitTask(t.id, t.answers.map((a, ix) => (ix === 0 ? { ...a, reply: "Retaken in daylight" } : a)), { lat: prop.lat, lng: prop.lng }));
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

  // A rough reading (a laptop on Wi-Fi or a VPN) can't pass or fail: it's recorded as approximate, with its accuracy.
  const rough = await freshTask();
  signInAs(rough.assignee_id);
  yes(await A.submitTask(rough.id, rough.answers, { lat: 51.5, lng: -0.12, acc: 25000 }));
  const s3 = (await one<{ location_ok: number | null; location_src: string; accuracy_m: number }>("SELECT location_ok, location_src, accuracy_m FROM submissions WHERE instance_id=?", rough.id))!;
  assert.equal(s3.location_ok, null);
  assert.equal(s3.location_src, "approx");
  assert.equal(s3.accuracy_m, 25000);
});

test("a task can't be sent with a compulsory photo or note missing, an unanswered question or a negative number", async () => {
  const t = await freshTask();
  await one("UPDATE template_items SET note_required=1 WHERE template_id=(SELECT template_id FROM instances WHERE id=?) AND kind='check' RETURNING id", t.id);
  signInAs(t.assignee_id);
  const send = (f: (a: typeof t.answers[number], ix: number) => object) => A.submitTask(t.id, t.answers.map((a, ix) => ({ ...a, ...f(a, ix) })), "simulated");
  const noPhoto = await send(() => ({ photos: [] }));
  assert.equal(noPhoto.ok, false);
  assert.match(noPhoto.ok ? "" : noPhoto.error, /Area clean.*photo/i);
  assert.match(String(((await send(() => ({ note: " " }))) as { error?: string }).error), /note/i);
  assert.match(String(((await send((a, ix) => (ix === 1 ? { value: "" } : {}))) as { error?: string }).error), /Pick an answer/);
  assert.match(String(((await send((a, ix) => (ix === 1 ? { value: "Maybe" } : {}))) as { error?: string }).error), /one of the options/);
  assert.match(String(((await send((a, ix) => (ix === 0 ? { checked: false, note: "" } : {}))) as { error?: string }).error), /say|why/i);
  assert.equal(await status(t.id), "current", "nothing was submitted");
  yes(await send(() => ({ note: "ok" })));
});

test("numbers can't be negative", async () => {
  const { answerIssue, nonNegative } = await import("@/lib/answers");
  const num = { id: 1, kind: "number" }, cnt = { id: 2, kind: "count" };
  assert.match(answerIssue(num, { value: "-3" })!, /negative/);
  assert.equal(answerIssue(num, { value: "0" }), null);
  assert.equal(answerIssue(num, { value: "2.5" }), null);
  assert.match(answerIssue(cnt, { value: "2.5" })!, /whole/);
  assert.match(answerIssue(num, { value: "abc" })!, /Enter a number/);
  assert.equal(nonNegative("-12"), "12");
  assert.equal(nonNegative("1.2.3"), "1.23");
  assert.equal(nonNegative("-4.5", true), "45");
});

test("a reviewer can pass an item with missing evidence, and the history says so", async () => {
  // Older submissions (from before evidence was enforced on the form) can still lack evidence.
  const t = await freshTask();
  signInAs(t.assignee_id);
  await E.submit(t.id, t.assignee_id, t.answers.map((a) => ({ ...a, photos: [] })), { ok: true, distance: 0 }, Date.now());
  signInAs(REVIEWER);
  yes(await A.reviewTask(t.id, "pass", [], "Photo upload was broken", Date.now()));
  assert.equal(await status(t.id), "audit");
  const ev = (await one<{ detail: string }>("SELECT detail FROM events WHERE instance_id=? AND type='passed'", t.id))!;
  assert.match(ev.detail, /accepted without evidence: Area clean/);
});

test("with Start/Stop on, a task can't be submitted before it's started", async () => {
  const t = await newTask();
  signInAs(t.assignee_id);
  const r = await A.submitTask(t.id, t.answers, "simulated");
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /Start task/);
  yes(await A.startTask(t.id));
  yes(await A.submitTask(t.id, t.answers, "simulated"));
});

test("an option can make a photo or a note compulsory", async () => {
  const { answerIssue } = await import("@/lib/answers");
  const it = { id: 1, kind: "choice", options: ["Yes", "No", "N/A"], option_rules: { Yes: { photo: true }, No: { note: true } } };
  assert.match(answerIssue(it, { value: "Yes", photos: [] })!, /photo.*"Yes"/);
  assert.equal(answerIssue(it, { value: "Yes", photos: ["a.jpg"] }), null);
  assert.match(answerIssue(it, { value: "No", note: "" })!, /note.*"No"/);
  assert.equal(answerIssue(it, { value: "No", note: "Lift stuck on 3rd floor" }), null);
  assert.equal(answerIssue(it, { value: "N/A" }), null);
  // Saved with the task, and kept only for options that exist.
  const src = (await one<{ id: number }>("SELECT id FROM templates WHERE trigger='scheduled' ORDER BY id LIMIT 1"))!.id;
  const base = (await one<A.TemplateInput & { id: number }>("SELECT * FROM templates WHERE id=?", src))!;
  const props = (await all<{ property_id: number }>("SELECT property_id FROM template_properties WHERE template_id=?", src)).map((p) => p.property_id);
  signInAs(1);
  const made = await A.saveTemplate(null, { ...base, name: "Lift check", description: "Lift", properties: props, items: [{ label: "Lift working?", kind: "choice",
    photo_allowed: true, photo_required: false, note_allowed: true, note_required: false, count_of: null, options: ["Yes", "No"], option_rules: { Yes: { photo: true }, No: { note: true }, Gone: { note: true } } }] });
  assert.ok(made.ok && made.id, JSON.stringify(made));
  const row = (await one<{ option_rules: string }>("SELECT option_rules FROM template_items WHERE template_id=?", made.id))!;
  assert.deepEqual(JSON.parse(row.option_rules), { Yes: { photo: true }, No: { note: true } });
});
