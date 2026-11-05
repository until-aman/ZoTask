// Team leave: each person's own weekly days off, leave and backup. Only admins manage it;
// central reviewers can see it, read-only, for the people at the properties they review.
import { all, one } from "./db";
import type { User } from "./auth";
import { addDays, isoDate } from "./time";
import { list } from "./engine";

export type TeamPerson = {
  id: number; name: string; access_role: string; op_role: string | null; props: string; propIds: number[];
  week: number[]; backup_id: number | null; leaves: { id: number; from: string; to: string; note: string | null }[];
};

/** The people this user may set days off for. */
export async function manageableIds(u: User): Promise<number[]> {
  // Only admins set week offs, leave and backups.
  if (u.access_role !== "admin") return [];
  return (await all<{ id: number }>("SELECT id FROM users WHERE archived=0")).map((x) => x.id);
}

/** Who may cover for `target`: same access role, still active, not themselves; a CBM picks ground staff from their own properties. */
export async function backupOptions(u: User, target: { id: number; access_role: string }): Promise<number[]> {
  const same = (await all<{ id: number }>("SELECT id FROM users WHERE archived=0 AND access_role=? AND id<>?", target.access_role, target.id)).map((x) => x.id);
  return u.access_role === "admin" ? same : [];
}

/** Properties a central reviewer is assigned: the properties in the clusters they review (Admin › Clusters). */
export async function reviewedProps(u: User): Promise<number[]> {
  if (u.access_role !== "reviewer") return [];
  return (await all<{ id: number }>("SELECT p.id FROM properties p JOIN clusters c ON c.id=p.cluster_id WHERE c.reviewer_id=? AND c.archived=0", u.id)).map((x) => x.id);
}

/** The people this user may see days off for: admins see everyone; a reviewer sees everyone working at their properties. */
export async function viewableIds(u: User): Promise<number[]> {
  if (u.access_role === "admin") return manageableIds(u);
  const props = await reviewedProps(u);
  if (!props.length) return [];
  const IN = `(${props.join(",")})`;
  return (await all<{ id: number }>(
    `SELECT u.id FROM users u WHERE u.archived=0 AND (u.id IN (SELECT user_id FROM user_properties WHERE property_id IN ${IN})
       OR u.id IN (SELECT cbm_id FROM properties WHERE id IN ${IN}))`)).map((x) => x.id);
}

export async function teamData(u: User) {
  const ids = await viewableIds(u);
  const scope = u.access_role === "admin" ? null : await reviewedProps(u);
  const today = isoDate(Date.now());
  if (!ids.length) return { people: [] as TeamPerson[], options: {} as Record<number, number[]>, names: {} as Record<number, string>, today };
  const IN = `(${ids.join(",")})`;
  const PS = scope ? ` AND p.id IN (${scope.join(",")})` : "";
  const people = await all<{ id: number; name: string; access_role: string; op_role: string | null; week_off: string | null; backup_id: number | null; props: string | null; prop_ids: string | null }>(
    `SELECT u.id, u.name, u.access_role, u.op_role, u.week_off, u.backup_id,
       (SELECT group_concat(p.name, ', ') FROM properties p WHERE (p.id IN (SELECT property_id FROM user_properties WHERE user_id=u.id) OR p.cbm_id=u.id)${PS}) props,
       (SELECT group_concat(p.id) FROM properties p WHERE (p.id IN (SELECT property_id FROM user_properties WHERE user_id=u.id) OR p.cbm_id=u.id)${PS}) prop_ids
     FROM users u WHERE u.id IN ${IN} ORDER BY CASE u.access_role WHEN 'reviewer' THEN 1 WHEN 'auditor' THEN 2 WHEN 'cbm' THEN 3 WHEN 'ground' THEN 4 ELSE 5 END, u.name`);
  const leaves = await all<{ id: number; user_id: number; from_date: string; to_date: string; note: string | null }>(
    `SELECT id, user_id, from_date, to_date, note FROM leaves WHERE user_id IN ${IN} AND to_date>=? ORDER BY from_date`, addDays(today, -30));
  const options: Record<number, number[]> = {};
  for (const p of people) options[p.id] = await backupOptions(u, p);
  const names = Object.fromEntries((await all<{ id: number; name: string }>("SELECT id, name FROM users")).map((x) => [x.id, x.name]));
  return {
    people: people.map((p): TeamPerson => ({
      id: p.id, name: p.name, access_role: p.access_role, op_role: p.op_role, props: p.props ?? "", propIds: (p.prop_ids ?? "").split(",").filter(Boolean).map(Number),
      week: list<number>(p.week_off), backup_id: p.backup_id,
      leaves: leaves.filter((l) => l.user_id === p.id).map((l) => ({ id: l.id, from: l.from_date, to: l.to_date, note: l.note })),
    })),
    options, names, today,
  };
}

export async function personFor(u: User, id: number) {
  if (!(await manageableIds(u)).includes(id)) throw new Error("You can't set days off for that person.");
  return (await one<{ id: number; name: string; access_role: string }>("SELECT id, name, access_role FROM users WHERE id=?", id))!;
}
export type TeamData = Awaited<ReturnType<typeof teamData>>;
