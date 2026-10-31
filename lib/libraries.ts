// Admin libraries (task categories, predefined checklists and schedules, cluster defaults) and the backfill for older task rows.
import { all, run } from "./db";

type Row = { id: number; name: string; category: string; trigger: string; event_name: string | null; frequency: string; weekday: number | null };

export async function seedLibraries() {
  const templates = await all<Row>("SELECT id, name, category, trigger, event_name, frequency, weekday FROM templates ORDER BY id");
  // Older rows hold one event and one weekday; the editor now keeps lists.
  for (const t of templates) {
    if (t.trigger === "event" && t.event_name) await run("UPDATE templates SET events=? WHERE id=? AND events='[]'", JSON.stringify([t.event_name]), t.id);
    if (t.frequency === "weekly") await run("UPDATE templates SET days=? WHERE id=? AND days='[]'", JSON.stringify([t.weekday ?? 1]), t.id);
    if (t.frequency === "monthly") await run("UPDATE templates SET days='[1]' WHERE id=? AND days='[]'", t.id);
  }
  for (const [pos, c] of [...new Set(templates.map((t) => t.category))].entries()) await run("INSERT OR IGNORE INTO task_categories (name, pos) VALUES (?,?)", c, pos);
  for (const t of templates) {
    const items = await all<{ label: string; kind: string; photo_required: number; note_required: number; photo_allowed: number; note_allowed: number; count_of: string | null }>(
      "SELECT label, kind, photo_required, note_required, photo_allowed, note_allowed, count_of FROM template_items WHERE template_id=? AND pos<1000 ORDER BY pos", t.id);
    await run("INSERT INTO checklist_presets (title, items) VALUES (?,?)", t.name, JSON.stringify(items));
  }
  for (const [name, frequency, days, start, end] of [
    ["Daily morning", "daily", [], "09:00", "10:00"],
    ["Daily evening", "daily", [], "18:00", "19:00"],
    ["Weekends", "weekly", [0, 6], "09:00", "10:00"],
    ["Start of month", "monthly", [1], "10:00", "12:00"],
  ] as const) await run("INSERT INTO schedule_presets (name, frequency, days, window_start, window_end) VALUES (?,?,?,?,?)", name, frequency, JSON.stringify(days), start, end);
  const reviewers = await all<{ id: number }>("SELECT id FROM users WHERE access_role='reviewer' ORDER BY id");
  const auditors = await all<{ id: number }>("SELECT id FROM users WHERE access_role='auditor' ORDER BY id");
  for (const [ix, c] of (await all<{ id: number }>("SELECT id FROM clusters ORDER BY id")).entries())
    await run("UPDATE clusters SET reviewer_id=coalesce(reviewer_id, ?), auditor_id=coalesce(auditor_id, ?) WHERE id=?", reviewers[ix % reviewers.length]?.id ?? null, auditors[ix % auditors.length]?.id ?? null, c.id);
}
