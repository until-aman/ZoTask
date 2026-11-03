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

/** A task started by hand (event trigger) at these properties. The real task list is all scheduled, so tests that start tasks bring their own. */
export async function handTask(props: number[]) {
  const id = (await one<{ id: number }>(`INSERT INTO templates (name, category, op_role, trigger, event_name, events, window_start, window_end, reviewer_id, auditor_id)
    VALUES ('Test check', 'Operations', 'CBM', 'event', 'Test event', '["Test event"]', '00:00', '23:59', ?, ?) RETURNING id`, REVIEWER, AUDITOR))!.id;
  await one("INSERT INTO template_items (template_id, pos, label, kind, photo_required) VALUES (?, 0, 'Area clean', 'check', 1) RETURNING id", id);
  await one("INSERT INTO template_items (template_id, pos, label, kind) VALUES (?, 1, 'Issues found?', 'yesno') RETURNING id", id);
  for (const p of props) await one("INSERT INTO template_properties VALUES (?, ?) RETURNING template_id", id, p);
  return id;
}
