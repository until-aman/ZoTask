// The task list: the CBM tasks from "Zo-Tasks for CBM.xlsx" (3 Nov 2026). It replaced every earlier task.
// The list itself is in cbm-tasks.json; each item keeps the reviewer's "what to check / how" notes from the sheet.
import type { InStatement } from "@libsql/client";
import { all, run } from "./db";
import TASKS from "./cbm-tasks.json";

/** Bump this to roll out a new task list: the next start replaces all tasks once. */
export const TASK_LIST_VERSION = "cbm-2026-11-03";

const st = (sql: string, ...args: (string | number | null)[]): InStatement => ({ sql, args });
const newId = "(SELECT max(id) FROM templates WHERE name=?)";

/**
 * The statements that add the CBM tasks at every property; the short-stay check-in task only where there are
 * short stays (all properties when that isn't known). Reviewers and auditors take the tasks in turn.
 * Each task's rows find it by name, so the whole list can go to the database in one batch.
 */
function addStatements(propIds: number[], reviewers: number[], auditors: number[], shortStayProps: number[]): InStatement[] {
  const out: InStatement[] = [];
  for (const [ix, t] of TASKS.entries()) {
    out.push(st(
      `INSERT INTO templates (name, category, op_role, trigger, frequency, days, weekday, window_start, window_end, review_sla_h, audit_sla_h,
        attempts_allowed, late_window_days, criticality, audit_rate, geofence, start_stop, reviewer_id, auditor_id)
       VALUES (?,?,'CBM','scheduled',?,?,?,?,?,24,48,3,?,?,?,?,?,?,?)`,
      t.name, t.category, t.frequency, JSON.stringify(t.days), t.days[0] ?? null, t.window_start, t.window_end,
      t.frequency === "weekly" ? 1 : 0, t.criticality, t.category === "Sales" ? 0.05 : 0.2, t.geofence, t.start_stop,
      reviewers.length ? reviewers[ix % reviewers.length] : null, auditors.length ? auditors[ix % auditors.length] : null));
    for (const [pos, it] of t.items.entries())
      out.push(st(`INSERT INTO template_items (template_id, pos, label, kind, photo_required, note_required, count_of, guide) VALUES (${newId},?,?,?,?,?,?,?)`,
        t.name, pos, it.label, it.kind, it.photo ? 1 : 0, it.note ? 1 : 0, it.count_of ?? null, it.guide || null));
    const props = t.category === "Short stays" && shortStayProps.length ? shortStayProps : propIds;
    for (const p of props) out.push(st(`INSERT INTO template_properties (template_id, property_id) VALUES (${newId},?)`, t.name, p));
  }
  return out;
}

/** Adds the CBM tasks (used when building sample data). */
export async function insertTaskList(reviewers: number[], auditors: number[], shortStayProps: number[] = []) {
  const props = (await all<{ id: number }>("SELECT id FROM properties ORDER BY id")).map((p) => p.id);
  for (const s of addStatements(props, reviewers, auditors, shortStayProps)) {
    const { sql, args } = s as { sql: string; args: unknown[] };
    await run(sql, ...args);
  }
}

const ids = async (role: string) => (await all<{ id: number }>("SELECT id FROM users WHERE access_role=? ORDER BY id", role)).map((u) => u.id);

/** True when this version's list is in place and checked for duplicates, so starts can skip the work. */
export async function taskListDone() {
  return (await all("SELECT k FROM meta WHERE k IN ('task_list','task_list_clean') AND v=?", TASK_LIST_VERSION)).length === 2;
}

/**
 * What a start still has to do for this TASK_LIST_VERSION, as one batch the caller sends in a single atomic write.
 * - A new version replaces every task and its history (runs, submissions, reviews, audit flags, events) with the
 *   CBM list. People, properties, escalations, the map and saved filters stay; escalations lose only their link
 *   to a removed run.
 * - Then, once, duplicate copies of a task (the first rollout ran on two servers at once) are removed.
 * Every statement is safe to repeat, so two servers sending it at once still end with one copy of each task.
 */
export async function taskListStatements(): Promise<InStatement[]> {
  const meta = new Map((await all<{ k: string; v: string }>("SELECT k, v FROM meta WHERE k IN ('task_list','task_list_clean')")).map((r) => [r.k, r.v]));
  const out: InStatement[] = [];
  if (meta.get("task_list") !== TASK_LIST_VERSION) {
    // Properties with short stays: wherever the old short-stay tasks ran.
    const shortStays = (await all<{ property_id: number }>(`SELECT DISTINCT tp.property_id FROM template_properties tp JOIN templates t ON t.id=tp.template_id
      WHERE t.category='Short stays' OR t.op_role='Short stays' ORDER BY tp.property_id`)).map((r) => r.property_id);
    const props = (await all<{ id: number }>("SELECT id FROM properties ORDER BY id")).map((p) => p.id);
    out.push(st("UPDATE escalations SET instance_id=NULL WHERE instance_id IS NOT NULL"));
    for (const t of ["review_flags", "reviews", "answers", "submissions", "events", "instances", "template_properties", "template_items", "templates"])
      out.push(st(`DELETE FROM ${t}`));
    out.push(...addStatements(props, await ids("reviewer"), await ids("auditor"), shortStays));
    out.push(st("INSERT OR REPLACE INTO meta (k, v) VALUES ('task_list', ?)", TASK_LIST_VERSION));
  }
  if (meta.get("task_list_clean") !== TASK_LIST_VERSION) {
    out.push(...duplicateStatements());
    out.push(st("INSERT OR REPLACE INTO meta (k, v) VALUES ('task_list_clean', ?)", TASK_LIST_VERSION));
  }
  return out;
}

/**
 * Removes duplicate copies of the list's tasks. For each name it keeps the copy with the most submissions
 * (the oldest on a tie); the kept copy covers every property any copy covered, and the other copies go with
 * their runs. Set-based, so it does nothing when there are no duplicates.
 */
function duplicateStatements(): InStatement[] {
  const names = TASKS.map((t) => t.name);
  const inList = `(${names.map(() => "?").join(",")})`;
  const keeper = (n: string) => `(SELECT k.id FROM templates k WHERE k.name=${n}
    ORDER BY (SELECT count(*) FROM submissions s JOIN instances i ON i.id=s.instance_id WHERE i.template_id=k.id) DESC, k.id LIMIT 1)`;
  const extra = `SELECT t.id FROM templates t WHERE t.name IN ${inList} AND t.id <> ${keeper("t.name")}`;
  const inst = `SELECT id FROM instances WHERE template_id IN (${extra})`;
  const q = (sql: string) => st(sql, ...names);
  return [
    q(`INSERT OR IGNORE INTO template_properties (template_id, property_id)
       SELECT ${keeper("t.name")}, tp.property_id FROM template_properties tp JOIN templates t ON t.id=tp.template_id WHERE t.id IN (${extra})`),
    q(`UPDATE escalations SET instance_id=NULL WHERE instance_id IN (${inst})`),
    q(`DELETE FROM review_flags WHERE review_id IN (SELECT id FROM reviews WHERE instance_id IN (${inst}))`),
    q(`DELETE FROM reviews WHERE instance_id IN (${inst})`),
    q(`DELETE FROM answers WHERE submission_id IN (SELECT id FROM submissions WHERE instance_id IN (${inst}))`),
    q(`DELETE FROM submissions WHERE instance_id IN (${inst})`),
    q(`DELETE FROM events WHERE instance_id IN (${inst})`),
    q(`DELETE FROM instances WHERE template_id IN (${extra})`),
    q(`DELETE FROM template_properties WHERE template_id IN (${extra})`),
    q(`DELETE FROM template_items WHERE template_id IN (${extra})`),
    q(`DELETE FROM templates WHERE id IN (${extra})`),
  ];
}
