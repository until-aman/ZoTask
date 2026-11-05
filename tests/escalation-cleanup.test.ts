// The one-time cleanup clears escalations raised before the cut-off day and keeps everything raised since.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ready, one } from "./helpers";
import { run, all } from "@/lib/db";
import { removeOldEscalations, ESCALATIONS_KEPT_FROM } from "@/lib/people";
import { DEPARTMENTS, TEAMS } from "@/lib/escalations";
import { dayStart } from "@/lib/time";

before(ready);

test("departments are the five teams, each with its contact", () => {
  assert.deepEqual(DEPARTMENTS, ["R&M", "HK & Facilities", "Warehouse", "Sourcing", "Central Support"]);
  for (const d of DEPARTMENTS) assert.ok(TEAMS[d]?.[1].endsWith("@zolostays.com"), d);
});

test("escalations before the cut-off go, with their updates and links; later ones stay; runs once", async () => {
  const cut = dayStart(ESCALATIONS_KEPT_FROM);
  const by = (await one<{ id: number }>("SELECT id FROM users LIMIT 1"))!.id, pid = (await one<{ id: number }>("SELECT id FROM properties LIMIT 1"))!.id;
  const add = async (at: number) => {
    const id = Number((await run("INSERT INTO escalations (department, title, priority, status, raised_by, owner_name, created_at, updated_at) VALUES ('R&M','t','medium','open',?,?,?,?)", by, "x", at, at)).lastInsertRowid);
    await run("INSERT INTO escalation_properties VALUES (?,?)", id, pid);
    await run("INSERT INTO escalation_updates (escalation_id, at, by_id, note, status) VALUES (?,?,?,?,?)", id, at, by, "Raised", "open");
    return id;
  };
  const old = await add(cut - 3600_000), fresh = await add(cut + 3600_000);
  const stmts = await removeOldEscalations();
  for (const s of stmts) typeof s === "string" ? await run(s) : await run(s.sql, ...(s.args as unknown[]));
  assert.equal(await one("SELECT 1 FROM escalations WHERE id=?", old), undefined);
  assert.equal(await one("SELECT 1 FROM escalation_updates WHERE escalation_id=?", old), undefined);
  assert.ok(await one("SELECT 1 FROM escalations WHERE id=?", fresh));
  assert.equal((await all("SELECT id FROM escalations WHERE created_at < ?", cut)).length, 0);
  assert.deepEqual(await removeOldEscalations(), [], "second start does nothing");
});

test("sample escalations put back after the clean-up go once; ones people raised stay", async () => {
  const { removeReseededSamples } = await import("@/lib/people");
  const { SAMPLE_ESCALATIONS } = await import("@/lib/escalations");
  const by = (await one<{ id: number }>("SELECT id FROM users LIMIT 1"))!.id, now = Date.now();
  const add = async (detail: string) => Number((await run("INSERT INTO escalations (department, title, detail, priority, status, raised_by, owner_name, created_at, updated_at) VALUES ('R&M','t',?,'medium','open',?,?,?,?)", detail, by, "x", now, now)).lastInsertRowid);
  const sample = await add(SAMPLE_ESCALATIONS[0][2]), real = await add("Lift stuck on 3rd floor since morning");
  for (const s of await removeReseededSamples()) typeof s === "string" ? await run(s) : await run(s.sql, ...(s.args as unknown[]));
  assert.equal(await one("SELECT 1 FROM escalations WHERE id=?", sample), undefined);
  assert.ok(await one("SELECT 1 FROM escalations WHERE id=?", real));
  assert.deepEqual(await removeReseededSamples(), [], "runs once");
});
