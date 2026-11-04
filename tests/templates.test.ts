// Saving a task's setup: a new task comes back with its id (the editor confirms it in a pop-up), an edit keeps its id.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import { signInAs, ready, one, all, ADMIN, REVIEWER } from "./helpers";

before(ready);

async function copyOf(id: number): Promise<A.TemplateInput> {
  const { id: _id, ...t } = (await one<A.TemplateInput & { id: number }>("SELECT * FROM templates WHERE id=?", id))!;
  void _id;
  const items = await all<A.TemplateItemInput>("SELECT label, kind, photo_allowed, photo_required, note_allowed, note_required, count_of, guide FROM template_items WHERE template_id=? ORDER BY pos", id);
  const properties = (await all<{ property_id: number }>("SELECT property_id FROM template_properties WHERE template_id=?", id)).map((p) => p.property_id);
  return { ...t, description: t.description || "A copy for the test", items, properties };
}

test("creating a task returns its new id; saving it again keeps the id", async () => {
  const src = (await one<{ id: number }>("SELECT id FROM templates ORDER BY id LIMIT 1"))!.id;
  const t = { ...(await copyOf(src)), name: "Saved pop-up check" };
  signInAs(REVIEWER);
  assert.equal((await A.saveTemplate(null, t)).ok, false);
  signInAs(ADMIN);
  const made = await A.saveTemplate(null, t);
  assert.ok(made.ok && made.id, JSON.stringify(made));
  assert.equal((await one<{ name: string }>("SELECT name FROM templates WHERE id=?", made.id))?.name, "Saved pop-up check");
  assert.equal((await one<{ n: number }>("SELECT count(*) n FROM template_items WHERE template_id=?", made.id))!.n, t.items.length);
  const again = await A.saveTemplate(made.id!, { ...t, name: "Saved pop-up check 2" });
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(again.id, made.id);
  assert.equal((await one<{ n: number }>("SELECT count(*) n FROM templates WHERE name LIKE 'Saved pop-up check%'"))!.n, 1);
});

test("an Options item saves its own answers, cleaned, and needs at least two", async () => {
  const src = (await one<{ id: number }>("SELECT id FROM templates ORDER BY id LIMIT 1"))!.id;
  const base = await copyOf(src);
  const choice = { label: "Lift working?", kind: "choice", photo_allowed: false, photo_required: false, note_allowed: true, note_required: false, count_of: null };
  signInAs(ADMIN);
  const one1 = await A.saveTemplate(null, { ...base, name: "Options check", items: [{ ...choice, options: ["Yes"] }] });
  assert.equal(one1.ok, false);
  assert.match(one1.ok ? "" : one1.error, /two options/);
  const made = await A.saveTemplate(null, { ...base, name: "Options check", items: [{ ...choice, options: [" Yes ", "No", "yes", "", "N/A"] }] });
  assert.ok(made.ok && made.id, JSON.stringify(made));
  const it = (await one<{ kind: string; options: string }>("SELECT kind, options FROM template_items WHERE template_id=?", made.id))!;
  assert.equal(it.kind, "choice");
  assert.deepEqual(JSON.parse(it.options), ["Yes", "No", "N/A"]);
});
