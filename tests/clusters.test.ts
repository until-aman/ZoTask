// Cluster sheet upload: the file replaces the clusters. Preview changes nothing; apply archives what the file leaves out.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/admin-actions";
import { sheetRows, Snapshot } from "@/lib/cluster-sheet";
import { signInAs, ready, one, all, ADMIN, REVIEWER, AUDITOR } from "./helpers";

before(ready);
const yes = (r: { ok: boolean }) => assert.equal(r.ok, true, JSON.stringify(r));

/** The sheet Download builds, from the database as it is now. */
async function download() {
  const s: Snapshot = {
    cities: await all("SELECT id, name FROM cities"),
    clusters: await all("SELECT id, name, city_id, reviewer_id, auditor_id, archived FROM clusters"),
    properties: await all("SELECT id, name, cluster_id, cbm_id FROM properties"),
    people: await all("SELECT id, name, email, access_role FROM users"),
  };
  return sheetRows(s);
}
async function preview(rows: string[][]) {
  signInAs(ADMIN);
  const r = await A.previewClusterSheet(rows);
  assert.ok(r.ok, JSON.stringify(r));
  return r.plan;
}
const C = { city: 0, cluster: 1, reviewer: 2, auditor: 3, property: 4, code: 5, cbm: 6 };
/** Two clusters in one city, each with at least two properties. */
async function pair() {
  return (await all<{ a: string; b: string }>(`SELECT a.name a, b.name b FROM clusters a JOIN clusters b ON b.city_id=a.city_id AND b.id>a.id
    WHERE a.archived=0 AND b.archived=0 AND (SELECT count(*) FROM properties WHERE cluster_id=a.id)>1 AND (SELECT count(*) FROM properties WHERE cluster_id=b.id)>1 LIMIT 1`))[0];
}

test("only admins can preview or apply the sheet", async () => {
  const rows = await download();
  signInAs(REVIEWER);
  assert.equal((await A.previewClusterSheet(rows)).ok, false);
  assert.equal((await A.applyClusterSheet(rows)).ok, false);
});

test("uploading the downloaded sheet unchanged changes nothing", async () => {
  const plan = await preview(await download());
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.create.length + plan.update.length + plan.archive.length + plan.moves.length, 0);
  assert.equal(plan.same, (await one<{ n: number }>("SELECT count(*) n FROM clusters WHERE archived=0"))!.n);
});

test("a property left out is an error, and apply changes nothing", async () => {
  const rows = (await download()).filter((r, i) => i !== 1);
  const plan = await preview(rows);
  assert.ok(plan.errors.some((e) => e.includes("is missing")), plan.errors.join("\n"));
  const before = await all("SELECT id, cluster_id FROM properties ORDER BY id");
  assert.equal((await A.applyClusterSheet(rows)).ok, false);
  assert.deepEqual(await all("SELECT id, cluster_id FROM properties ORDER BY id"), before);
});

test("unknown reviewer, same reviewer and auditor, and a property in the wrong city each name their row", async () => {
  const reviewer = (await one<{ email: string }>("SELECT email FROM users WHERE id=?", REVIEWER))!.email;
  const auditor = (await one<{ name: string }>("SELECT name FROM users WHERE id=?", AUDITOR))!.name;
  const other = (await one<{ name: string }>("SELECT name FROM cities ORDER BY id DESC LIMIT 1"))!.name;
  const rows = await download();
  rows[1][C.reviewer] = "Nobody Here";
  rows[2][C.reviewer] = reviewer; rows[2][C.auditor] = reviewer.toUpperCase();
  rows[3][C.reviewer] = reviewer; rows[3][C.auditor] = auditor;
  const far = rows.findIndex((r, i) => i > 3 && r[C.city] !== other && r[C.property]);
  rows[far][C.city] = other;
  const errors = (await preview(rows)).errors;
  assert.ok(errors.some((e) => e.startsWith("Row 2:") && e.includes("Nobody Here")), errors.join("\n"));
  assert.ok(errors.some((e) => e.startsWith("Row 3:") && e.includes("same person")), errors.join("\n"));
  assert.ok(!errors.some((e) => e.startsWith("Row 4:") && /no reviewer|no auditor|not a/.test(e)), errors.join("\n"));
  assert.ok(errors.some((e) => e.startsWith(`Row ${far + 1}:`) && e.includes(`not ${other}`)), errors.join("\n"));
});

test("the CBM column adds a CBM, reuses one by name, and refuses someone who isn't a CBM", async () => {
  const OPEN = "('upcoming','current','notsub','review','resub','changes','audit','auditflag','flagans')";
  const reviewer = (await one<{ name: string }>("SELECT name FROM users WHERE id=?", REVIEWER))!.name;
  const rows = await download();
  const [a, b] = [rows[1], rows[2]];
  const other = (await one<{ name: string }>("SELECT u.name FROM users u JOIN properties p ON p.cbm_id=u.id WHERE p.name<>? AND p.cbm_id<>(SELECT cbm_id FROM properties WHERE name=?) LIMIT 1", b[C.property], b[C.property]))!.name;
  a[C.cbm] = "New.Cbm@zolostays.com"; b[C.cbm] = other; rows[3][C.cbm] = reviewer;
  const bad = await preview(rows);
  assert.ok(bad.errors.some((e) => e.startsWith("Row 4:") && e.includes("not a CBM")), bad.errors.join("\n"));
  rows[3][C.cbm] = (await download())[3][C.cbm];
  const plan = await preview(rows);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.newCbms, [{ name: "New Cbm", email: "New.Cbm@zolostays.com" }]);
  assert.deepEqual(plan.cbms.map((c) => [c.property, c.to]), [[a[C.property], "New Cbm (new)"], [b[C.property], other]]);
  yes(await A.applyClusterSheet(rows));
  const p = (await one<{ id: number; cbm_id: number }>("SELECT id, cbm_id FROM properties WHERE name=?", a[C.property]))!;
  assert.equal((await one<{ access_role: string; email: string }>("SELECT access_role, email FROM users WHERE id=?", p.cbm_id))?.access_role, "cbm");
  assert.deepEqual((await all<{ user_id: number }>("SELECT up.user_id FROM user_properties up JOIN users u ON u.id=up.user_id WHERE up.property_id=? AND u.access_role='cbm'", p.id)).map((x) => x.user_id), [p.cbm_id]);
  assert.equal((await one<{ n: number }>(`SELECT count(*) n FROM instances i JOIN templates t ON t.id=i.template_id
    WHERE i.property_id=? AND i.status IN ${OPEN} AND t.op_role='CBM' AND i.assignee_id IS NOT ?`, p.id, p.cbm_id))!.n, 0);
  assert.equal((await preview(await download())).cbms.length, 0);
});

test("moving a property and renaming a cluster", async () => {
  const { a, b } = await pair();
  const rows = await download();
  for (const r of rows) if (r[C.cluster] === a) r[C.cluster] = `${a} North`;
  const moved = rows.find((r) => r[C.cluster] === b)!, into = rows.find((r) => r[C.cluster] === `${a} North`)!;
  moved[C.cluster] = into[C.cluster]; moved[C.reviewer] = into[C.reviewer]; moved[C.auditor] = into[C.auditor];
  const plan = await preview(rows);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.create.length, 0);
  assert.equal(plan.update.filter((u) => u.changes.some((c) => c.startsWith("renamed"))).length, 1);
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].property, moved[C.property]);
  yes(await A.applyClusterSheet(rows));
  const p = await one<{ name: string }>("SELECT c.name FROM properties p JOIN clusters c ON c.id=p.cluster_id WHERE p.name=?", moved[C.property]);
  assert.equal(p?.name, `${a} North`);
  assert.equal((await preview(await download())).same, plan.same + plan.update.length);
});

test("a cluster left out of the file is archived, not deleted", async () => {
  const { a, b } = await pair();
  const id = (await one<{ id: number }>("SELECT id FROM clusters WHERE name=?", a))!.id;
  const rows = await download();
  for (const r of rows) if (r[C.cluster] === a) { r[C.cluster] = b; r[C.reviewer] = ""; r[C.auditor] = ""; }
  const plan = await preview(rows);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.archive.map((c) => c.name), [a]);
  yes(await A.applyClusterSheet(rows));
  assert.equal((await one<{ archived: number }>("SELECT archived FROM clusters WHERE id=?", id))?.archived, 1);
  assert.equal((await one<{ n: number }>("SELECT count(*) n FROM properties WHERE cluster_id=?", id))!.n, 0);
});
