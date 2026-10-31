"use server";
// Admin libraries and bulk task actions. Every action checks the caller is an admin.
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { all, one, run, tx } from "@/lib/db";

type Result = { ok: true; msg?: string } | { ok: false; error: string };
async function admin(fn: () => Promise<string | void>): Promise<Result> {
  const u = await requireUser();
  if (!can.admin(u)) return { ok: false, error: "Only admins can change this." };
  try {
    const msg = await tx(fn);
    revalidatePath("/", "layout");
    return { ok: true, msg: msg || undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
const need = (v: string, what: string) => { if (!v.trim()) throw new Error(`Add ${what}.`); return v.trim(); };

// Task categories
export async function addCategory(name: string) {
  return admin(async () => {
    const n = need(name, "a category name");
    if (await one("SELECT 1 FROM task_categories WHERE lower(name)=lower(?)", n)) throw new Error(`"${n}" already exists.`);
    const pos = (await one<{ p: number }>("SELECT coalesce(max(pos), -1) + 1 p FROM task_categories"))!.p;
    await run("INSERT INTO task_categories (name, pos) VALUES (?,?)", n, pos);
    return `Added "${n}".`;
  });
}
export async function moveCategory(id: number, dir: -1 | 1) {
  return admin(async () => {
    const rows = await all<{ id: number }>("SELECT id FROM task_categories ORDER BY archived, pos, id");
    const i = rows.findIndex((r) => r.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (const [pos, r] of rows.entries()) await run("UPDATE task_categories SET pos=? WHERE id=?", pos, r.id);
  });
}
export async function archiveCategory(id: number, archived: boolean) {
  return admin(async () => { await run("UPDATE task_categories SET archived=? WHERE id=?", archived ? 1 : 0, id); return archived ? "Archived. Tasks already in it keep it." : "Restored."; });
}

// Predefined checklists and schedules
export type PresetItem = { label: string; kind: string; photo_allowed: boolean; photo_required: boolean; note_allowed: boolean; note_required: boolean; count_of: string | null };
export async function saveChecklistPreset(id: number | null, title: string, items: PresetItem[]) {
  return admin(async () => {
    const t = need(title, "a checklist title");
    const its = items.filter((i) => i.label.trim());
    if (!its.length) throw new Error("Add at least one item.");
    if (id) await run("UPDATE checklist_presets SET title=?, items=? WHERE id=?", t, JSON.stringify(its), id);
    else await run("INSERT INTO checklist_presets (title, items) VALUES (?,?)", t, JSON.stringify(its));
    return `Saved "${t}".`;
  });
}
export async function deleteChecklistPreset(id: number) {
  return admin(async () => { await run("DELETE FROM checklist_presets WHERE id=?", id); return "Deleted. Tasks that used it keep their items."; });
}
export type SchedulePreset = { name: string; frequency: string; days: number[]; once_date: string | null; window_start: string; window_end: string };
export async function saveSchedulePreset(id: number | null, s: SchedulePreset) {
  return admin(async () => {
    const n = need(s.name, "a schedule name");
    if (s.window_end <= s.window_start) throw new Error("End time must be after start time.");
    if ((s.frequency === "weekly" || s.frequency === "monthly") && !s.days.length) throw new Error("Pick at least one day.");
    if (s.frequency === "once" && !s.once_date) throw new Error("Pick the date.");
    const vals = [n, s.frequency, JSON.stringify(s.days), s.once_date, s.window_start, s.window_end];
    if (id) await run("UPDATE schedule_presets SET name=?, frequency=?, days=?, once_date=?, window_start=?, window_end=? WHERE id=?", ...vals, id);
    else await run("INSERT INTO schedule_presets (name, frequency, days, once_date, window_start, window_end) VALUES (?,?,?,?,?,?)", ...vals);
    return `Saved "${n}".`;
  });
}
export async function deleteSchedulePreset(id: number) {
  return admin(async () => { await run("DELETE FROM schedule_presets WHERE id=?", id); return "Deleted."; });
}

// HK and SHK ideal counts. Blank (null) keeps the saved number.
export async function saveCounts(rows: { property_id: number; ideal_hk: number | null; ideal_shk: number | null }[]) {
  return admin(async () => {
    let n = 0;
    for (const r of rows) {
      for (const v of [r.ideal_hk, r.ideal_shk]) if (v !== null && (!Number.isInteger(v) || v < 0 || v > 200)) throw new Error("Counts must be whole numbers from 0 to 200.");
      const cur = await one<{ ideal_hk: number; ideal_shk: number }>("SELECT ideal_hk, ideal_shk FROM staffing WHERE property_id=?", r.property_id);
      const hk = r.ideal_hk ?? cur?.ideal_hk ?? 0, shk = r.ideal_shk ?? cur?.ideal_shk ?? 0;
      if (cur) await run("UPDATE staffing SET ideal_hk=?, ideal_shk=? WHERE property_id=?", hk, shk, r.property_id);
      else await run("INSERT INTO staffing (property_id, ideal_hk, current_hk, ideal_shk, current_shk) VALUES (?,?,0,?,0)", r.property_id, hk, shk);
      n++;
    }
    return `Saved counts for ${n} ${n === 1 ? "property" : "properties"}.`;
  });
}

// Clusters
export async function saveCluster(id: number | null, c: { name: string; city_id: number; reviewer_id: number | null; auditor_id: number | null; properties: number[] }) {
  return admin(async () => {
    const n = need(c.name, "a cluster name");
    if (c.reviewer_id && c.reviewer_id === c.auditor_id) throw new Error("The auditor must be a different person from the reviewer.");
    let cid = id;
    if (id) await run("UPDATE clusters SET name=?, city_id=?, reviewer_id=?, auditor_id=? WHERE id=?", n, c.city_id, c.reviewer_id, c.auditor_id, id);
    else cid = (await run("INSERT INTO clusters (name, city_id, reviewer_id, auditor_id) VALUES (?,?,?,?)", n, c.city_id, c.reviewer_id, c.auditor_id)).lastInsertRowid;
    for (const p of c.properties) await run("UPDATE properties SET cluster_id=? WHERE id=?", cid, p);
    return `Saved "${n}".`;
  });
}
export async function archiveCluster(id: number, archived: boolean) {
  return admin(async () => {
    if (archived && (await one<{ n: number }>("SELECT count(*) n FROM properties WHERE cluster_id=?", id))!.n) throw new Error("Move its properties to another cluster first.");
    await run("UPDATE clusters SET archived=? WHERE id=?", archived ? 1 : 0, id);
    return archived ? "Archived." : "Restored.";
  });
}

// Bulk task actions
export async function setTasksActive(ids: number[], active: boolean) {
  return admin(async () => {
    for (const id of ids) await run("UPDATE templates SET active=? WHERE id=?", active ? 1 : 0, id);
    return `${active ? "Resumed" : "Paused"} ${ids.length} ${ids.length === 1 ? "task" : "tasks"}.`;
  });
}
/** Adds the tasks to more properties. Tasks already there are left as they are. */
export async function copyTasksTo(ids: number[], properties: number[]) {
  return admin(async () => {
    if (!ids.length || !properties.length) throw new Error("Pick at least one task and one property.");
    let n = 0;
    for (const t of ids) for (const p of properties) n += (await run("INSERT OR IGNORE INTO template_properties VALUES (?,?)", t, p)).changes;
    return n ? `Added ${n} task–property ${n === 1 ? "link" : "links"}. They start from the next window.` : "Those properties already have these tasks.";
  });
}
/** Deletes tasks that never ran; tasks with history are paused instead so reports stay intact. */
export async function deleteTasks(ids: number[]) {
  return admin(async () => {
    let del = 0, paused = 0;
    for (const id of ids) {
      if (await one("SELECT 1 FROM instances WHERE template_id=? LIMIT 1", id)) { await run("UPDATE templates SET active=0 WHERE id=?", id); paused++; continue; }
      await run("DELETE FROM template_items WHERE template_id=?", id);
      await run("DELETE FROM template_properties WHERE template_id=?", id);
      await run("DELETE FROM templates WHERE id=?", id);
      del++;
    }
    const out = [del && `deleted ${del}`, paused && `paused ${paused} that already ran, so reports keep their history`].filter(Boolean).join(", ");
    return out.charAt(0).toUpperCase() + out.slice(1) + ".";
  });
}
