// Saved filters: rename, replace what they hold, make default, delete. Each person only touches their own.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import { signInAs, ready, one, ADMIN, REVIEWER } from "./helpers";

before(ready);
const view = async (id: number) => (await one<{ name: string; filters: string; is_default: number }>("SELECT name, filters, is_default FROM saved_views WHERE id=?", id))!;

test("a saved filter can be renamed, updated, made default and deleted", async () => {
  signInAs(ADMIN);
  const a = (await A.saveView("tests", "Pune", { city: "Pune" }, false)).id!;
  const b = (await A.saveView("tests", "Chennai", { city: "Chennai" }, false)).id!;

  assert.equal((await A.updateView(a, "  Pune   week ")).ok, true);
  assert.equal((await view(a)).name, "Pune week");
  assert.deepEqual(JSON.parse((await view(a)).filters), { city: "Pune" }, "renaming alone keeps the filters");

  assert.equal((await A.updateView(a, "Pune week", { city: "Pune", range: "30d" })).ok, true);
  assert.deepEqual(JSON.parse((await view(a)).filters), { city: "Pune", range: "30d" });

  assert.equal((await A.updateView(b, "pune WEEK")).ok, false, "names stay unique, ignoring case");
  assert.equal((await A.updateView(b, "   ")).ok, false, "a name is required");

  await A.setDefaultView(b, true);
  await A.setDefaultView(a, true);
  assert.deepEqual([(await view(a)).is_default, (await view(b)).is_default], [1, 0], "only one default per page");

  signInAs(REVIEWER);
  assert.equal((await A.updateView(a, "Mine now")).ok, false, "someone else's saved filter can't be changed");

  signInAs(ADMIN);
  await A.deleteView(a); await A.deleteView(b);
  assert.equal(await one("SELECT id FROM saved_views WHERE id IN (?,?)", a, b), undefined);
});
