// Shared test helpers: sign in as someone, and find sample records.
import { __setCookie } from "./shims/headers";
import { all, one, db } from "@/lib/db";

export const signInAs = (id: number) => __setCookie("uid", String(id));
export const ready = () => db();
export { all, one };

/** Ground staff, CBM and an open task at a property, from the seeded data. */
export async function at(propertyId: number) {
  const cbm = (await one<{ cbm_id: number }>("SELECT cbm_id FROM properties WHERE id=?", propertyId))!.cbm_id;
  const ground = (await one<{ user_id: number }>("SELECT up.user_id FROM user_properties up JOIN users u ON u.id=up.user_id WHERE up.property_id=? AND u.access_role='ground' ORDER BY u.id LIMIT 1", propertyId))!.user_id;
  const task = (await one<{ id: number }>("SELECT id FROM instances WHERE property_id=? ORDER BY id LIMIT 1", propertyId))!.id;
  return { cbm, ground, task };
}
export const ADMIN = 1, REVIEWER = 2, REVIEWER2 = 3, AUDITOR = 5;
