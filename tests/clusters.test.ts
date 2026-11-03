// Bulk cluster mapping upload: preview changes nothing, apply creates and moves exactly what the preview said.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/admin-actions";
import { signInAs, ready, one, all, ADMIN, REVIEWER } from "./helpers";

before(async () => { await ready(); });

const row = (line: number, city: string, cluster: string, property: string, reviewer: string, auditor: string, code = ""): A.MappingRow => ({ line, code, city, cluster, property, reviewer, auditor });
const sheet = [
  row(2, "Pune", "Pune Kharadi 1", "Zolo Avalon", "akash.sh@zolostays.com", "karthick.l@zolostays.com", "ZP049"),
  row(3, "Pune", "Pune Kharadi 1", "Zolo Harmony", "akash.sh@zolostays.com", "karthick.l@zolostays.com"),
  row(4, "Coimbatore", "Coimbatore 1", "Zolo Arcade", "lindashalini.y@zolostays.com", "karthick.l@zolostays.com"),
  row(5, "Coimbatore", "Coimbatore 1", "Zolo Edison", "lindashalini.y@zolostays.com", "karthick.l@zolostays.com"),
  row(6, "Coimbatore", "Coimbatore 1", "Zolo Arcade", "lindashalini.y@zolostays.com", "karthick.l@zolostays.com"),
  row(7, "Pune", "", "Zolo Nowhere", "", ""),
];

test("only admins can preview or apply a cluster sheet", async () => {
  signInAs(REVIEWER);
  assert.equal((await A.previewClusterSheet(sheet, true)).ok, false);
  assert.equal((await A.applyClusterSheet(sheet, true)).ok, false);
});

test("preview reports new cities, clusters, properties, moves and people without changing anything", async () => {
  signInAs(ADMIN);
  const before = await one<{ n: number }>("SELECT count(*) n FROM clusters");
  const r = await A.previewClusterSheet(sheet, true);
  assert.ok(r.ok, JSON.stringify(r));
  const p = r.plan;
  assert.deepEqual(p.newCities, ["Coimbatore"]);
  assert.deepEqual(p.newClusters.sort(), ["Coimbatore 1 (Coimbatore)", "Pune Kharadi 1 (Pune)"]);
  assert.deepEqual(p.moves, [{ property: "Zolo Harmony", from: "Hinjewadi", to: "Pune Kharadi 1" }]);
  assert.deepEqual(p.newProps.map((x) => x.property).sort(), ["Zolo Arcade", "Zolo Avalon", "Zolo Edison"]);
  assert.deepEqual(p.newPeople.map((x) => [x.name, x.role]).sort(), [["Akash Sh", "reviewer"], ["Lindashalini Y", "reviewer"]]);
  assert.equal(p.problems.length, 2, p.problems.join("\n"));
  assert.equal((await one<{ n: number }>("SELECT count(*) n FROM clusters"))!.n, before!.n);
});

test("apply creates the clusters, sets reviewer and auditor, and moves properties", async () => {
  signInAs(ADMIN);
  const r = await A.applyClusterSheet(sheet, true);
  assert.ok(r.ok, JSON.stringify(r));
  const cl = await one<{ id: number; rv: string; au: string }>(
    "SELECT c.id, r.email rv, a.email au FROM clusters c JOIN cities ci ON ci.id=c.city_id LEFT JOIN users r ON r.id=c.reviewer_id LEFT JOIN users a ON a.id=c.auditor_id WHERE ci.name='Pune' AND c.name='Pune Kharadi 1'");
  assert.deepEqual([cl?.rv, cl?.au], ["akash.sh@zolostays.com", "karthick.l@zolostays.com"]);
  const names = (await all<{ name: string }>("SELECT name FROM properties WHERE cluster_id=? ORDER BY name", cl!.id)).map((x) => x.name);
  assert.deepEqual(names, ["Zolo Avalon", "Zolo Harmony"]);
  // A second upload of the same sheet has nothing left to do.
  const again = await A.previewClusterSheet(sheet, true);
  assert.ok(again.ok);
  assert.equal(again.plan.newClusters.length + again.plan.moves.length + again.plan.newProps.length + again.plan.leads.length + again.plan.newPeople.length, 0);
  assert.equal(again.plan.same, 4);
});
