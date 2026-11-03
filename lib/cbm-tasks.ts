// The task list: the CBM tasks from "Zo-Tasks for CBM.xlsx" (3 Nov 2026). It replaced every earlier task.
// The list itself is in cbm-tasks.json; each item keeps the reviewer's "what to check / how" notes from the sheet.
import { all, one, run, tx } from "./db";
import TASKS from "./cbm-tasks.json";

/** Bump this to roll out a new task list: the next start replaces all tasks once. */
export const TASK_LIST_VERSION = "cbm-2026-11-03";

/**
 * Adds the CBM tasks at every property; the short-stay check-in task only where there are short stays
 * (all properties when that isn't known). Reviewers and auditors take the tasks in turn.
 */
export async function insertTaskList(reviewers: number[], auditors: number[], shortStayProps: number[] = []) {
  const all_ = (await all<{ id: number }>("SELECT id FROM properties ORDER BY id")).map((p) => p.id);
  for (const [ix, t] of TASKS.entries()) {
    const tid = Number((await run(
      `INSERT INTO templates (name, category, op_role, trigger, frequency, days, weekday, window_start, window_end, review_sla_h, audit_sla_h,
        attempts_allowed, late_window_days, criticality, audit_rate, geofence, start_stop, reviewer_id, auditor_id)
       VALUES (?,?,'CBM','scheduled',?,?,?,?,?,24,48,3,?,?,?,?,?,?,?)`,
      t.name, t.category, t.frequency, JSON.stringify(t.days), t.days[0] ?? null, t.window_start, t.window_end,
      t.frequency === "weekly" ? 1 : 0, t.criticality, t.category === "Sales" ? 0.05 : 0.2, t.geofence, t.start_stop,
      reviewers.length ? reviewers[ix % reviewers.length] : null, auditors.length ? auditors[ix % auditors.length] : null)).lastInsertRowid);
    for (const [pos, it] of t.items.entries())
      await run("INSERT INTO template_items (template_id, pos, label, kind, photo_required, note_required, count_of, guide) VALUES (?,?,?,?,?,?,?,?)",
        tid, pos, it.label, it.kind, it.photo ? 1 : 0, it.note ? 1 : 0, it.count_of, it.guide || null);
    const props = t.category === "Short stays" && shortStayProps.length ? shortStayProps : all_;
    for (const p of props) await run("INSERT INTO template_properties VALUES (?,?)", tid, p);
  }
}

/**
 * Runs once per TASK_LIST_VERSION: removes every task with all of its history (runs, submissions,
 * reviews, audit flags, events), then adds the CBM task list. People, properties, escalations,
 * the map and saved filters stay; escalations lose only their link to a removed task run.
 */
export async function applyTaskList() {
  if (await one("SELECT 1 FROM meta WHERE k='task_list' AND v=?", TASK_LIST_VERSION)) return;
  await tx(async () => {
    if (await one("SELECT 1 FROM meta WHERE k='task_list' AND v=?", TASK_LIST_VERSION)) return;
    // Properties with short stays: wherever the old short-stay tasks ran.
    const shortStays = (await all<{ property_id: number }>(`SELECT DISTINCT tp.property_id FROM template_properties tp JOIN templates t ON t.id=tp.template_id
      WHERE t.category='Short stays' OR t.op_role='Short stays' ORDER BY tp.property_id`)).map((r) => r.property_id);
    await run("UPDATE escalations SET instance_id=NULL WHERE instance_id IS NOT NULL");
    for (const t of ["review_flags", "reviews", "answers", "submissions", "events", "instances", "template_properties", "template_items", "templates"])
      await run(`DELETE FROM ${t}`);
    const ids = async (role: string) => (await all<{ id: number }>("SELECT id FROM users WHERE access_role=? ORDER BY id", role)).map((u) => u.id);
    await insertTaskList(await ids("reviewer"), await ids("auditor"), shortStays);
    await run("INSERT OR REPLACE INTO meta (k, v) VALUES ('task_list', ?)", TASK_LIST_VERSION);
  });
}
