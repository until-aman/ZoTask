// One-off people changes to the live database.
import type { InStatement } from "@libsql/client";
import { one, run } from "./db";
import { GEO } from "./seed";

/** Tasks that can still be reviewed or audited. */
const OPEN = "('upcoming','current','notsub','review','resub','changes','audit','auditflag','flagans')";

// The three reviewers that came with the sample data, found by name and their sample email.
const SAMPLE = [["Vankadara Lakshmi Kavya", "vankadara.lakshmi.kavya@zolostays.com"], ["Hrithik Singh", "hrithik.singh@zolostays.com"], ["Priya Menon", "priya.menon@zolostays.com"]];
const OLD = `(SELECT id FROM users WHERE access_role='reviewer' AND (${SAMPLE.map(() => "(name=? AND lower(email)=?)").join(" OR ")}))`;
const KEY = "sample_reviewers_removed";

// The sample properties, each in its sample city and cluster.
const SAMPLE_PROPS = Object.entries(GEO).flatMap(([city, cl]) => Object.entries(cl).flatMap(([cluster, props]) => props.map(([name]) => [city, cluster, name])));

/**
 * First removes the sample properties still in a sample reviewer's cluster, with their tasks and task history, and
 * archives the clusters that leaves empty, along with the CBMs and ground staff who worked only there. Then takes the sample reviewers out of clusters, tasks, saved filters and
 * every list. Their open tasks go to their cluster's reviewer (none until the cluster sheet names one). Anyone with no history is deleted; anyone who
 * reviewed or did something is archived instead, so past reviews and reports keep their name. Runs once.
 */
export async function removeSampleReviewers(): Promise<InStatement[]> {
  if (await one("SELECT v FROM meta WHERE k=?", KEY)) return [];
  const old = SAMPLE.flat();
  const st = (sql: string): InStatement => ({ sql, args: old });
  const used = ["reviews WHERE reviewer_id", "submissions WHERE submitted_by", "events WHERE actor_id", "instances WHERE reviewer_id", "instances WHERE auditor_id",
    "instances WHERE assignee_id", "escalations WHERE raised_by", "escalations WHERE owner_id", "escalation_updates WHERE by_id"]
    .map((w) => `NOT EXISTS (SELECT 1 FROM ${w}=users.id)`).join(" AND ");
  // The sample properties, only while they are still where the sample data put them.
  const P = `(SELECT p.id FROM properties p JOIN clusters c ON c.id=p.cluster_id JOIN cities ci ON ci.id=c.city_id
    WHERE c.reviewer_id IN ${OLD} AND (ci.name, c.name, p.name) IN (VALUES ${SAMPLE_PROPS.map(() => "(?,?,?)").join(",")}))`;
  const I = `(SELECT id FROM instances WHERE property_id IN ${P})`;
  const sp = (sql: string, times = 1): InStatement => ({ sql, args: Array.from({ length: times }, () => [...old, ...SAMPLE_PROPS.flat()]).flat() });
  return [
    sp(`UPDATE escalations SET instance_id=NULL WHERE instance_id IN ${I}`),
    sp(`DELETE FROM review_flags WHERE review_id IN (SELECT id FROM reviews WHERE instance_id IN ${I})`),
    sp(`DELETE FROM reviews WHERE instance_id IN ${I}`),
    sp(`DELETE FROM answers WHERE submission_id IN (SELECT id FROM submissions WHERE instance_id IN ${I})`),
    sp(`DELETE FROM submissions WHERE instance_id IN ${I}`),
    sp(`DELETE FROM events WHERE instance_id IN ${I}`),
    sp(`DELETE FROM instances WHERE property_id IN ${P}`),
    sp(`DELETE FROM template_properties WHERE property_id IN ${P}`),
    // Sample CBMs and ground staff: everyone whose properties are all sample ones.
    sp(`UPDATE users SET archived=1 WHERE access_role IN ('cbm','ground')
        AND EXISTS (SELECT 1 FROM user_properties up WHERE up.user_id=users.id AND up.property_id IN ${P})
        AND NOT EXISTS (SELECT 1 FROM user_properties up WHERE up.user_id=users.id AND up.property_id NOT IN ${P})
        AND NOT EXISTS (SELECT 1 FROM properties x WHERE x.cbm_id=users.id AND x.id NOT IN ${P})`, 3),
    sp(`DELETE FROM user_properties WHERE property_id IN ${P}`),
    sp(`DELETE FROM staffing WHERE property_id IN ${P}`),
    sp(`DELETE FROM escalation_properties WHERE property_id IN ${P}`),
    sp(`UPDATE map_sites SET property_id=NULL WHERE property_id IN ${P}`),
    sp(`UPDATE clusters SET archived=1 WHERE id IN (SELECT cluster_id FROM properties WHERE id IN ${P})
        AND NOT EXISTS (SELECT 1 FROM properties x WHERE x.cluster_id=clusters.id AND x.id NOT IN ${P})`, 2),
    sp(`DELETE FROM properties WHERE id IN ${P}`),
    st(`UPDATE clusters SET reviewer_id=NULL WHERE reviewer_id IN ${OLD}`),
    st(`UPDATE templates SET reviewer_id=NULL WHERE reviewer_id IN ${OLD}`),
    st(`UPDATE instances SET reviewer_id=(SELECT c.reviewer_id FROM properties p JOIN clusters c ON c.id=p.cluster_id WHERE p.id=instances.property_id)
        WHERE status IN ${OPEN} AND reviewer_id IN ${OLD}`),
    st(`DELETE FROM saved_views WHERE user_id IN ${OLD}`),
    st(`DELETE FROM user_properties WHERE user_id IN ${OLD}`),
    st(`UPDATE users SET archived=1 WHERE id IN ${OLD}`),
    st(`DELETE FROM users WHERE id IN ${OLD} AND ${used}`),
    { sql: `DELETE FROM users WHERE archived=1 AND access_role IN ('cbm','ground') AND ${used}
        AND NOT EXISTS (SELECT 1 FROM properties x WHERE x.cbm_id=users.id) AND NOT EXISTS (SELECT 1 FROM saved_views v WHERE v.user_id=users.id)` },
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", args: [KEY, String(Date.now())] },
  ];
}

/**
 * Makes this person the property's CBM (or none): its CBM link moves, and its open CBM tasks that had no one or the
 * old CBM go to the new one.
 */
export async function setPropertyCbm(propertyId: number, cbmId: number | null) {
  const old = (await one<{ cbm_id: number | null }>("SELECT cbm_id FROM properties WHERE id=?", propertyId))?.cbm_id ?? null;
  await run("UPDATE properties SET cbm_id=? WHERE id=?", cbmId, propertyId);
  await run("DELETE FROM user_properties WHERE property_id=? AND user_id IN (SELECT id FROM users WHERE access_role='cbm')", propertyId);
  if (cbmId) await run("INSERT OR IGNORE INTO user_properties (user_id, property_id) VALUES (?,?)", cbmId, propertyId);
  await run(`UPDATE instances SET assignee_id=? WHERE property_id=? AND status IN ${OPEN} AND (assignee_id IS NULL OR assignee_id IS ?)
    AND template_id IN (SELECT id FROM templates WHERE op_role='CBM')`, cbmId, propertyId, old);
}

/** Open tasks at a cluster's properties that have no reviewer or auditor take the cluster's. */
export async function fillFromCluster(clusterId: number) {
  for (const role of ["reviewer_id", "auditor_id"])
    await run(`UPDATE instances SET ${role}=(SELECT ${role} FROM clusters WHERE id=?)
      WHERE ${role} IS NULL AND status IN ${OPEN} AND property_id IN (SELECT id FROM properties WHERE cluster_id=?)`, clusterId, clusterId);
}

/**
 * Removes escalations left with no property: the sample ones, whose properties went with the sample data.
 * Their update notes go too, and tasks lose only their link to them. Runs once.
 */
export async function removeSampleEscalations(): Promise<InStatement[]> {
  const key = "sample_escalations_removed";
  if (await one("SELECT v FROM meta WHERE k=?", key)) return [];
  const E = "(SELECT id FROM escalations e WHERE NOT EXISTS (SELECT 1 FROM escalation_properties ep WHERE ep.escalation_id=e.id))";
  return [
    `DELETE FROM escalation_updates WHERE escalation_id IN ${E}`,
    `DELETE FROM escalations WHERE id IN ${E}`,
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", args: [key, String(Date.now())] },
  ];
}
