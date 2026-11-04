// Admin → Tasks → ⋯ → Properties: the ticked list is exactly where the task runs.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { setTaskProperties } from "@/app/admin-actions";
import { run } from "@/lib/db";
import { signInAs, ready, one, all, handTask, ADMIN, REVIEWER } from "./helpers";

before(ready);

test("ticking and unticking properties syncs the task, and drops runs not yet open at removed ones", async () => {
  const tid = await handTask([1, 2]);
  const future = Date.now() + 5 * 86_400_000;
  const up = Number((await run(`INSERT INTO instances (template_id, property_id, task_date, window_start_at, window_end_at, late_until_at, status, status_since, source)
    VALUES (?, 1, '2099-01-01', ?, ?, ?, 'upcoming', ?, 'schedule')`, tid, future, future + 3600_000, future + 7200_000, Date.now())).lastInsertRowid);
  signInAs(REVIEWER);
  assert.equal((await setTaskProperties(tid, [2])).ok, false);
  signInAs(ADMIN);
  const r = await setTaskProperties(tid, [2, 3]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const links = (await all<{ p: number }>("SELECT property_id p FROM template_properties WHERE template_id=? ORDER BY p", tid)).map((x) => x.p);
  assert.deepEqual(links, [2, 3]);
  assert.equal(await one("SELECT 1 FROM instances WHERE id=?", up), undefined);
  assert.equal((await setTaskProperties(tid, [2, 3])).ok, true);
});
