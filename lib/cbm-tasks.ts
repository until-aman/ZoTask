// The task list: the CBM tasks from "Zo-Tasks for CBM.xlsx" (3 Nov 2026). It replaced every earlier task.
// The list itself is in cbm-tasks.json; each item keeps the reviewer's "what to check / how" notes from the sheet.
import { all, one, run } from "./db";
import TASKS from "./cbm-tasks.json";

/** Bump this to roll out a new task list: the next start replaces all tasks once. */
export const TASK_LIST_VERSION = "cbm-2026-11-03";

/**
 * Adds the CBM tasks at every property; the short-stay check-in task only where there are short stays
 * (all properties when that isn't known). Reviewers and auditors take the tasks in turn.
 */
export async function insertTaskList(reviewers: number[], auditors: number[], shortStayProps: number[] = [], only?: Set<string>) {
  const all_ = (await all<{ id: number }>("SELECT id FROM properties ORDER BY id")).map((p) => p.id);
  for (const [ix, t] of TASKS.entries()) {
    if (only && !only.has(t.name)) continue;
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

const ids = async (role: string) => (await all<{ id: number }>("SELECT id FROM users WHERE access_role=? ORDER BY id", role)).map((u) => u.id);

/** True when this version's list is in place and checked for duplicates, so starts can skip the work. */
export async function taskListDone() {
  return (await all("SELECT k FROM meta WHERE k IN ('task_list','task_list_clean') AND v=?", TASK_LIST_VERSION)).length === 2;
}

/**
 * Runs once per TASK_LIST_VERSION: removes every task with all of its history (runs, submissions,
 * reviews, audit flags, events), then adds the CBM task list. People, properties, escalations,
 * the map and saved filters stay; escalations lose only their link to a removed task run.
 * The caller runs it inside one write transaction, so two servers starting at once can't both add the list.
 */
export async function applyTaskList() {
  if (!(await one("SELECT 1 FROM meta WHERE k='task_list' AND v=?", TASK_LIST_VERSION))) {
    // Properties with short stays: wherever the old short-stay tasks ran.
    const shortStays = (await all<{ property_id: number }>(`SELECT DISTINCT tp.property_id FROM template_properties tp JOIN templates t ON t.id=tp.template_id
      WHERE t.category='Short stays' OR t.op_role='Short stays' ORDER BY tp.property_id`)).map((r) => r.property_id);
    await run("UPDATE escalations SET instance_id=NULL WHERE instance_id IS NOT NULL");
    for (const t of ["review_flags", "reviews", "answers", "submissions", "events", "instances", "template_properties", "template_items", "templates"])
      await run(`DELETE FROM ${t}`);
    await insertTaskList(await ids("reviewer"), await ids("auditor"), shortStays);
    await run("INSERT OR REPLACE INTO meta (k, v) VALUES ('task_list', ?)", TASK_LIST_VERSION);
  }
  await removeDuplicates();
}

/**
 * One-time repair: the first rollout could run on two servers at once and add the list twice.
 * For each task in the list, keeps the copy with the most submissions (the oldest on a tie), moves
 * nothing else, and deletes the other copies with their runs. The kept copy covers every property
 * any copy covered. A task missing altogether is added back.
 */
export async function removeDuplicates() {
  if (await one("SELECT 1 FROM meta WHERE k='task_list_clean' AND v=?", TASK_LIST_VERSION)) return;
  const names = TASKS.map((t) => t.name);
  const q = names.map(() => "?").join(",");
  const rows = await all<{ id: number; name: string; subs: number }>(
    `SELECT t.id, t.name, (SELECT count(*) FROM submissions s JOIN instances i ON i.id=s.instance_id WHERE i.template_id=t.id) subs
     FROM templates t WHERE t.name IN (${q}) ORDER BY t.name, subs DESC, t.id`, ...names);
  const keep = new Map<string, number>();
  const extra: { id: number; keep: number }[] = [];
  for (const r of rows) {
    const k = keep.get(r.name);
    if (k === undefined) keep.set(r.name, r.id); else extra.push({ id: r.id, keep: k });
  }
  for (const { id, keep: k } of extra) {
    await run("INSERT OR IGNORE INTO template_properties (template_id, property_id) SELECT ?, property_id FROM template_properties WHERE template_id=?", k, id);
    const inst = "SELECT id FROM instances WHERE template_id=?";
    const sub = `SELECT id FROM submissions WHERE instance_id IN (${inst})`;
    const rev = `SELECT id FROM reviews WHERE instance_id IN (${inst})`;
    await run(`UPDATE escalations SET instance_id=NULL WHERE instance_id IN (${inst})`, id);
    await run(`DELETE FROM review_flags WHERE review_id IN (${rev})`, id);
    await run(`DELETE FROM reviews WHERE instance_id IN (${inst})`, id);
    await run(`DELETE FROM answers WHERE submission_id IN (${sub})`, id);
    await run(`DELETE FROM submissions WHERE instance_id IN (${inst})`, id);
    await run(`DELETE FROM events WHERE instance_id IN (${inst})`, id);
    await run("DELETE FROM instances WHERE template_id=?", id);
    await run("DELETE FROM template_properties WHERE template_id=?", id);
    await run("DELETE FROM template_items WHERE template_id=?", id);
    await run("DELETE FROM templates WHERE id=?", id);
  }
  const missing = new Set(names.filter((n) => !keep.has(n)));
  if (missing.size) await insertTaskList(await ids("reviewer"), await ids("auditor"), [], missing);
  await run("INSERT OR REPLACE INTO meta (k, v) VALUES ('task_list_clean', ?)", TASK_LIST_VERSION);
}
