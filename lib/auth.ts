import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { all, one } from "./db";

export type User = { id: number; name: string; email: string; access_role: string; op_role: string | null };

export async function currentUser(): Promise<User | null> {
  const uid = (await cookies()).get("uid")?.value;
  if (!uid) return null;
  return one<User>("SELECT * FROM users WHERE id=?", Number(uid)) ?? null;
}
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Property ids a user can see. Central roles see everything. */
export function scopeProps(u: User): number[] {
  if (["admin", "reviewer", "auditor"].includes(u.access_role)) return all<{ id: number }>("SELECT id FROM properties").map((p) => p.id);
  return all<{ property_id: number }>("SELECT property_id FROM user_properties WHERE user_id=?", u.id).map((p) => p.property_id);
}

export const can = {
  queue: (u: User) => u.access_role !== "ground",
  dashboard: (u: User) => u.access_role !== "ground",
  admin: (u: User) => u.access_role === "admin",
  tasks: (u: User) => ["ground", "cbm"].includes(u.access_role),
};
