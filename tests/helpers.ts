// Shared test helpers: sign in as someone, and find sample records.
import { __setCookie } from "./shims/headers";
import { all, one, run, db } from "@/lib/db";

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
/** The seeded tasks are all scheduled CBM tasks, so tests that start a task by hand add an event task for ground staff at every property. */
export async function eventTemplate() {
  const have = await one<{ id: number }>("SELECT id FROM templates WHERE name='Test event task'");
  if (have) return have.id;
  const id = Number((await run("INSERT INTO templates (name, category, op_role, trigger, event_name, events, window_start, window_end) VALUES ('Test event task', 'Operations', 'HK', 'event', 'Tenant exited', '[\"Tenant exited\"]', '10:00', '14:00')")).lastInsertRowid);
  for (const [pos, label, photo] of [[0, "Room cleaned", 1], [1, "Inventory checked", 0]] as const)
    await run("INSERT INTO template_items (template_id, pos, label, kind, photo_required) VALUES (?,?,?,'check',?)", id, pos, label, photo);
  await run("INSERT INTO template_properties SELECT ?, id FROM properties", id);
  return id;
}
export const ADMIN = 1, REVIEWER = 2, REVIEWER2 = 3, AUDITOR = 5;
