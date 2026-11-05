// Taking a property off a task removes its runs there that nobody has submitted, today's included, so they stop counting.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/admin-actions";
import * as E from "@/lib/engine";
import { signInAs, ready, one, ADMIN } from "./helpers";
import { run } from "@/lib/db";

before(ready);
// Early in the IST day no window has opened yet, so make sure there are open, unsent runs to work with.
before(async () => {
  await run(`UPDATE instances SET status='current' WHERE id IN (SELECT id FROM instances WHERE source='schedule' AND attempt=0 AND first_submitted_at IS NULL AND status='upcoming' LIMIT 20)`);
});
const OPEN = "source='schedule' AND attempt=0 AND first_submitted_at IS NULL AND status IN ('current','notsub')";

test("unticking a property drops today's unsent runs there, and keeps submitted ones", async () => {
  const i = (await one<{ id: number; template_id: number; property_id: number }>(`SELECT id, template_id, property_id FROM instances WHERE ${OPEN} LIMIT 1`))!;
  const sent = (await one<{ id: number }>("SELECT id FROM instances WHERE template_id=? AND property_id=? AND first_submitted_at IS NOT NULL LIMIT 1", i.template_id, i.property_id));
  const keep = (await one<{ ps: string }>("SELECT group_concat(property_id) ps FROM template_properties WHERE template_id=? AND property_id<>?", i.template_id, i.property_id))!.ps.split(",").map(Number);
  signInAs(ADMIN);
  const r = await A.setTaskProperties(i.template_id, keep);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await one("SELECT 1 FROM instances WHERE id=?", i.id), undefined, "today's unsent run is gone");
  if (sent) assert.ok(await one("SELECT 1 FROM instances WHERE id=?", sent.id), "a submitted run stays");
});

test("runs left behind at properties a task no longer covers are cleared on the next sweep", async () => {
  const i = (await one<{ id: number; template_id: number; property_id: number }>(`SELECT id, template_id, property_id FROM instances WHERE ${OPEN} LIMIT 1`))!;
  await run("DELETE FROM template_properties WHERE template_id=? AND property_id=?", i.template_id, i.property_id);
  await E.sweep();
  assert.equal(await one("SELECT 1 FROM instances WHERE id=?", i.id), undefined);
});
