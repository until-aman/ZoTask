import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { all, one } from "./db";

export type User = { id: number; name: string; email: string; access_role: string; op_role: string | null };

export async function currentUser(): Promise<User | null> {
  const uid = (await cookies()).get("uid")?.value;
  if (!uid) return null;
  return await one<User>("SELECT * FROM users WHERE id=? AND archived=0", Number(uid)) ?? null;
}
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Property ids a user can see. Central roles see everything. */
export async function scopeProps(u: User): Promise<number[]> {
  if (["admin", "reviewer", "auditor"].includes(u.access_role)) return (await all<{ id: number }>("SELECT id FROM properties")).map((p) => p.id);
  return (await all<{ property_id: number }>("SELECT property_id FROM user_properties WHERE user_id=?", u.id)).map((p) => p.property_id);
}

export const isCentral = (u: User) => ["admin", "reviewer", "auditor"].includes(u.access_role);

/** Whether a property is one the user works on. Central roles cover every property. */
export async function inScope(u: User, propertyId: number): Promise<boolean> {
  if (isCentral(u)) return true;
  return !!(await one("SELECT 1 FROM user_properties WHERE user_id=? AND property_id=? UNION SELECT 1 FROM properties WHERE id=? AND cbm_id=?", u.id, propertyId, propertyId, u.id));
}

/** The task's property, if the user may see the task; null when the task doesn't exist or is outside their properties. */
export async function taskInScope(u: User, instanceId: number): Promise<number | null> {
  if (!Number.isInteger(instanceId) || instanceId <= 0) return null;
  const i = await one<{ property_id: number }>("SELECT property_id FROM instances WHERE id=?", instanceId);
  if (!i) return null;
  return (await inScope(u, i.property_id)) ? i.property_id : null;
}

/** Throws unless every task is one the user may act on. */
export async function requireTasks(u: User, ids: number[]) {
  for (const id of ids) if ((await taskInScope(u, id)) === null) throw new Error("That task isn't at one of your properties.");
}

export const can = {
  queue: (u: User) => u.access_role !== "ground",
  dashboard: (u: User) => u.access_role !== "ground",
  admin: (u: User) => u.access_role === "admin",
  tasks: (u: User) => ["ground", "cbm"].includes(u.access_role),
};
