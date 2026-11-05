// Team availability: a central reviewer sees, read-only, the week offs and leave of everyone at the properties they review.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import { teamData, reviewedProps } from "@/lib/team";
import type { User } from "@/lib/auth";
import { signInAs, ready, one, all, ADMIN, REVIEWER, AUDITOR } from "./helpers";
import { addDays, isoDate } from "@/lib/time";

before(ready);
const user = async (id: number) => (await one<User>("SELECT * FROM users WHERE id=?", id))!;

test("a reviewer sees everyone at their clusters' properties, and nobody else", async () => {
  const mine = (await all<{ id: number }>("SELECT p.id FROM properties p JOIN clusters c ON c.id=p.cluster_id WHERE c.reviewer_id=?", REVIEWER)).map((x) => x.id);
  assert.ok(mine.length, "the sample data gives the reviewer some clusters");
  assert.deepEqual((await reviewedProps(await user(REVIEWER))).sort(), mine.sort());

  const t = await teamData(await user(REVIEWER));
  const expected = (await all<{ id: number }>(`SELECT DISTINCT u.id FROM users u WHERE u.archived=0 AND (u.id IN (SELECT user_id FROM user_properties WHERE property_id IN (${mine.join(",")}))
    OR u.id IN (SELECT cbm_id FROM properties WHERE id IN (${mine.join(",")})))`)).map((x) => x.id).sort((a, b) => a - b);
  assert.deepEqual(t.people.map((p) => p.id).sort((a, b) => a - b), expected);
  assert.ok(t.people.some((p) => p.access_role === "cbm") && t.people.some((p) => p.access_role === "ground"), "CBMs and ground staff both show");
  for (const p of t.people) assert.ok(p.propIds.every((id) => mine.includes(id)), "only the reviewer's own properties are listed for each person");
  assert.ok(Object.values(t.options).every((o) => o.length === 0), "no backup choices: the view is read-only");
});

test("leave set by an admin shows to the reviewer, who can't change it", async () => {
  const mine = await reviewedProps(await user(REVIEWER));
  const cbm = (await one<{ cbm_id: number }>(`SELECT cbm_id FROM properties WHERE id IN (${mine.join(",")}) AND cbm_id IS NOT NULL LIMIT 1`))!.cbm_id;
  const from = addDays(isoDate(Date.now()), 2);
  signInAs(ADMIN);
  assert.equal((await A.addLeave(cbm, from, from, "Family function")).ok, true);
  const p = (await teamData(await user(REVIEWER))).people.find((x) => x.id === cbm)!;
  assert.deepEqual(p.leaves.map((l) => [l.from, l.note]), [[from, "Family function"]]);

  signInAs(REVIEWER);
  assert.equal((await A.addLeave(cbm, from, from, "x")).ok, false);
  assert.equal((await A.saveWeekOff(cbm, [0], null)).ok, false);
});

test("other roles see nobody", async () => {
  const cbm = (await one<{ id: number }>("SELECT id FROM users WHERE access_role='cbm' LIMIT 1"))!.id;
  const ground = (await one<{ id: number }>("SELECT id FROM users WHERE access_role='ground' LIMIT 1"))!.id;
  for (const id of [AUDITOR, cbm, ground]) assert.equal((await teamData(await user(id))).people.length, 0);
});
