// Removing the sample reviewers and their sample properties from the live database.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/admin-actions";
import { db } from "@/lib/db";
import { removeSampleReviewers } from "@/lib/people";
import { signInAs, ready, one, all, ADMIN } from "./helpers";

before(ready);
const OLD = ["Vankadara Lakshmi Kavya", "Hrithik Singh", "Priya Menon"];
const OPEN = "('upcoming','current','notsub','review','resub','changes','audit','auditflag','flagans')";

test("an open task with no reviewer takes the one its cluster is given", async () => {
  signInAs(ADMIN);
  const nu = (await one<{ id: number }>("INSERT INTO users (name, email, access_role) VALUES ('New Reviewer', 'new.reviewer@zolostays.com', 'reviewer') RETURNING id"))!.id;
  const t = (await one<{ id: number; cluster_id: number }>(`SELECT i.id, p.cluster_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.status IN ${OPEN} LIMIT 1`))!;
  await one("UPDATE instances SET reviewer_id=NULL WHERE id=? RETURNING id", t.id);
  const c = (await one<{ id: number; name: string; city_id: number; reviewer_id: number; auditor_id: number | null }>("SELECT id, name, city_id, reviewer_id, auditor_id FROM clusters WHERE id=?", t.cluster_id))!;
  const props = (await all<{ id: number }>("SELECT id FROM properties WHERE cluster_id=?", c.id)).map((p) => p.id);
  const r = await A.saveCluster(c.id, { ...c, reviewer_id: nu, properties: props });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await one<{ reviewer_id: number }>("SELECT reviewer_id FROM instances WHERE id=?", t.id))!.reviewer_id, nu);
  await one("UPDATE clusters SET reviewer_id=? WHERE id=? RETURNING id", c.reviewer_id, c.id);
});

test("sample properties and reviewers go; a property moved to a real cluster stays; it runs once", async () => {
  // Zolo Coastline has moved to a real cluster with a real reviewer, so it stays with its tasks.
  const city = (await one<{ id: number }>("SELECT id FROM cities WHERE name='Chennai'"))!.id;
  const nu = (await one<{ id: number }>("SELECT id FROM users WHERE name='New Reviewer'"))!.id;
  const real = (await one<{ id: number }>("INSERT INTO clusters (city_id, name, reviewer_id) VALUES (?, 'Chennai 1', ?) RETURNING id", city, nu))!.id;
  const kept = (await one<{ id: number }>("UPDATE properties SET cluster_id=? WHERE name='Zolo Coastline' RETURNING id", real))!.id;
  const keptTasks = (await one<{ n: number }>("SELECT count(*) n FROM instances WHERE property_id=?", kept))!.n;
  assert.ok(keptTasks > 0);

  await (await db()).batch(await removeSampleReviewers(), "write");
  assert.deepEqual((await all<{ name: string }>("SELECT name FROM properties")).map((p) => p.name), ["Zolo Coastline"]);
  assert.equal((await one<{ n: number }>("SELECT count(*) n FROM instances WHERE property_id=?", kept))!.n, keptTasks);
  for (const t of ["instances", "template_properties", "user_properties", "staffing", "escalation_properties"])
    assert.equal((await one<{ n: number }>(`SELECT count(*) n FROM ${t} WHERE property_id<>?`, kept))!.n, 0, t);
  for (const [t, c] of [["submissions", "instance_id"], ["reviews", "instance_id"], ["events", "instance_id"]])
    assert.equal((await one<{ n: number }>(`SELECT count(*) n FROM ${t} WHERE ${c} NOT IN (SELECT id FROM instances)`))!.n, 0, t);
  // The sample clusters are empty, so archived; the real one is not.
  assert.deepEqual((await all<{ name: string }>("SELECT name FROM clusters WHERE archived=0")).map((c) => c.name), ["Chennai 1"]);
  // The sample reviewers are out of every list: deleted, or archived if something of theirs is left.
  const left = await all<{ archived: number; reviewer_of: number; views: number }>(`SELECT archived,
    (SELECT count(*) FROM clusters c WHERE c.reviewer_id=u.id) + (SELECT count(*) FROM templates t WHERE t.reviewer_id=u.id) reviewer_of,
    (SELECT count(*) FROM saved_views v WHERE v.user_id=u.id) views FROM users u WHERE name IN (?,?,?)`, ...OLD);
  for (const u of left) assert.deepEqual(u, { archived: 1, reviewer_of: 0, views: 0 });
  // Staff who worked only at sample properties are gone; Zolo Coastline's staff stay.
  assert.deepEqual(await all(`SELECT id FROM users WHERE access_role IN ('cbm','ground') AND archived=0
    AND id NOT IN (SELECT user_id FROM user_properties WHERE property_id=?) AND id NOT IN (SELECT cbm_id FROM properties)`, kept), []);
  assert.ok((await one<{ n: number }>("SELECT count(*) n FROM user_properties up JOIN users u ON u.id=up.user_id WHERE up.property_id=? AND u.archived=0", kept))!.n > 0);
  assert.deepEqual(await removeSampleReviewers(), []);
});
