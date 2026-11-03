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

// Cluster mapping sheet: one row per property, naming its city, cluster, and the cluster's reviewer and auditor by email.
export type MappingRow = { line: number; code: string; city: string; cluster: string; property: string; reviewer: string; auditor: string };
export type MappingPlan = {
  rows: number; newCities: string[]; newClusters: string[]; restored: string[];
  leads: { cluster: string; reviewer?: string; auditor?: string }[];
  moves: { property: string; from: string; to: string }[]; newProps: { property: string; cluster: string }[]; same: number;
  newPeople: { email: string; name: string; role: "reviewer" | "auditor" }[]; problems: string[];
};
const low = (s: string) => s.trim().toLowerCase();
const nameFromEmail = (e: string) => e.split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

async function mappingPlan(input: MappingRow[], addPeople: boolean) {
  const cities = await all<{ id: number; name: string }>("SELECT id, name FROM cities");
  const clusters = await all<{ id: number; name: string; city_id: number; reviewer_id: number | null; auditor_id: number | null; archived: number }>("SELECT id, name, city_id, reviewer_id, auditor_id, archived FROM clusters");
  const props = await all<{ id: number; name: string; cluster_id: number }>("SELECT id, name, cluster_id FROM properties ORDER BY id");
  const codes = await all<{ code: string; property_id: number }>("SELECT code, property_id FROM map_sites WHERE code IS NOT NULL AND property_id IS NOT NULL");
  const users = await all<{ id: number; name: string; email: string | null; access_role: string }>("SELECT id, name, email, access_role FROM users");
  const p: MappingPlan = { rows: input.length, newCities: [], newClusters: [], restored: [], leads: [], moves: [], newProps: [], same: 0, newPeople: [], problems: [] };
  const cityOf = (n: string) => cities.find((c) => low(c.name) === low(n));
  const clusterIn = (cityId: number | undefined, n: string) => (cityId ? clusters.find((c) => c.city_id === cityId && low(c.name) === low(n)) : undefined);
  const clName = (id: number) => clusters.find((c) => c.id === id)?.name ?? "?";

  // Reviewer and auditor per cluster, from its first row; a person is found by email and must hold that role.
  const person = (email: string, role: "reviewer" | "auditor", line: number) => {
    if (!email) return undefined;
    const u = users.find((x) => x.email && low(x.email) === low(email));
    if (u) {
      if (u.access_role !== role && u.access_role !== "admin") { p.problems.push(`Row ${line}: ${u.name} (${email}) is not a${role === "auditor" ? "n" : ""} ${role}, so they were left out.`); return null; }
      return u;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { p.problems.push(`Row ${line}: "${email}" is not an email address.`); return null; }
    if (!p.newPeople.some((x) => low(x.email) === low(email))) p.newPeople.push({ email: email.trim(), name: nameFromEmail(email), role });
    return addPeople ? { id: 0, name: nameFromEmail(email), email, access_role: role } : null;
  };

  type Want = { city: string; cluster: string; reviewer?: { id: number; name: string; email: string | null } | null; auditor?: { id: number; name: string; email: string | null } | null; line: number };
  const want = new Map<string, Want>();
  const assign: { line: number; property: string; code: string; key: string }[] = [];
  const seen = new Map<string, number>();
  for (const r of input) {
    if (!r.city || !r.cluster || !r.property) { p.problems.push(`Row ${r.line}: needs City Name, Cluster Name and Property name. Skipped.`); continue; }
    const key = `${low(r.city)}|${low(r.cluster)}`;
    const dup = seen.get(low(r.property));
    if (dup) { p.problems.push(`Row ${r.line}: ${r.property} is already on row ${dup}. Skipped.`); continue; }
    seen.set(low(r.property), r.line);
    const w = want.get(key);
    if (!w) {
      const rv = person(r.reviewer, "reviewer", r.line), au = person(r.auditor, "auditor", r.line);
      if (rv && au && low(rv.email ?? "") === low(au.email ?? "")) { p.problems.push(`Row ${r.line}: the auditor must be a different person from the reviewer, so the auditor was left out.`); want.set(key, { city: r.city, cluster: r.cluster, reviewer: rv, auditor: null, line: r.line }); }
      else want.set(key, { city: r.city, cluster: r.cluster, reviewer: rv, auditor: au, line: r.line });
    } else if ((r.reviewer && low(r.reviewer) !== low(w.reviewer?.email ?? r.reviewer)) || (r.auditor && low(r.auditor) !== low(w.auditor?.email ?? r.auditor))) {
      p.problems.push(`Row ${r.line}: ${r.cluster} names a different reviewer or auditor than row ${w.line}. Row ${w.line} was used.`);
    }
    assign.push({ line: r.line, property: r.property, code: r.code, key });
  }

  for (const w of want.values()) {
    const city = cityOf(w.city);
    if (!city && !p.newCities.some((c) => low(c) === low(w.city))) p.newCities.push(w.city.trim());
    const cl = clusterIn(city?.id, w.cluster);
    if (!cl) p.newClusters.push(`${w.cluster.trim()} (${w.city.trim()})`);
    else if (cl.archived) p.restored.push(cl.name);
    const lead: MappingPlan["leads"][number] = { cluster: w.cluster.trim() };
    if (w.reviewer && (!cl || w.reviewer.id !== cl.reviewer_id)) lead.reviewer = w.reviewer.name;
    if (w.auditor && (!cl || w.auditor.id !== cl.auditor_id)) lead.auditor = w.auditor.name;
    if (lead.reviewer || lead.auditor) p.leads.push(lead);
  }
  const found: { property: string; key: string; propId: number | null }[] = [];
  for (const a of assign) {
    const viaCode = a.code ? codes.find((c) => low(c.code) === low(a.code)) : undefined;
    const prop = (viaCode && props.find((x) => x.id === viaCode.property_id)) || props.find((x) => low(x.name) === low(a.property));
    const w = want.get(a.key)!, cl = clusterIn(cityOf(w.city)?.id, w.cluster);
    if (!prop) p.newProps.push({ property: a.property.trim(), cluster: w.cluster.trim() });
    else if (cl && prop.cluster_id === cl.id) p.same++;
    else p.moves.push({ property: prop.name, from: clName(prop.cluster_id), to: w.cluster.trim() });
    found.push({ property: a.property.trim(), key: a.key, propId: prop?.id ?? null });
  }
  return { plan: p, want, found };
}

/** What uploading the sheet would change, without changing anything. */
export async function previewClusterSheet(rows: MappingRow[], addPeople: boolean): Promise<{ ok: true; plan: MappingPlan } | { ok: false; error: string }> {
  const u = await requireUser();
  if (!can.admin(u)) return { ok: false, error: "Only admins can change this." };
  if (!rows.length) return { ok: false, error: "The sheet has no rows under the header." };
  try { return { ok: true, plan: (await mappingPlan(rows, addPeople)).plan }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Creates missing cities, clusters, properties (and, if asked, people), sets each cluster's reviewer and auditor, and moves properties into place. */
export async function applyClusterSheet(rows: MappingRow[], addPeople: boolean) {
  return admin(async () => {
    const { plan, want, found } = await mappingPlan(rows, addPeople);
    const people = new Map<string, number>();
    if (addPeople) for (const n of plan.newPeople) people.set(low(n.email), Number((await run("INSERT INTO users (name, email, access_role) VALUES (?,?,?)", n.name, n.email, n.role)).lastInsertRowid));
    const idOf = (x: { id: number; email: string | null } | null | undefined) => (!x ? undefined : x.id || people.get(low(x.email ?? "")));
    const clusterIds = new Map<string, number>();
    for (const [key, w] of want) {
      let city = await one<{ id: number }>("SELECT id FROM cities WHERE lower(name)=lower(?)", w.city.trim());
      if (!city) city = { id: Number((await run("INSERT INTO cities (name) VALUES (?)", w.city.trim())).lastInsertRowid) };
      const cl = await one<{ id: number; reviewer_id: number | null; auditor_id: number | null }>("SELECT id, reviewer_id, auditor_id FROM clusters WHERE city_id=? AND lower(name)=lower(?)", city.id, w.cluster.trim());
      const rv = idOf(w.reviewer) ?? cl?.reviewer_id ?? null, au = idOf(w.auditor) ?? cl?.auditor_id ?? null;
      if (cl) { await run("UPDATE clusters SET reviewer_id=?, auditor_id=?, archived=0 WHERE id=?", rv, au, cl.id); clusterIds.set(key, cl.id); }
      else clusterIds.set(key, Number((await run("INSERT INTO clusters (name, city_id, reviewer_id, auditor_id) VALUES (?,?,?,?)", w.cluster.trim(), city.id, rv, au)).lastInsertRowid));
    }
    for (const f of found) {
      const cid = clusterIds.get(f.key)!;
      if (f.propId) await run("UPDATE properties SET cluster_id=? WHERE id=?", cid, f.propId);
      else await run("INSERT INTO properties (cluster_id, name) VALUES (?,?)", cid, f.property);
    }
    const bits = [plan.newClusters.length && `${plan.newClusters.length} new cluster${plan.newClusters.length > 1 ? "s" : ""}`,
      plan.moves.length && `${plan.moves.length} propert${plan.moves.length > 1 ? "ies" : "y"} moved`,
      plan.newProps.length && `${plan.newProps.length} propert${plan.newProps.length > 1 ? "ies" : "y"} added`,
      plan.leads.length && `${plan.leads.length} reviewer/auditor update${plan.leads.length > 1 ? "s" : ""}`,
      addPeople && plan.newPeople.length && `${plan.newPeople.length} people added`].filter(Boolean);
    return bits.length ? `Uploaded: ${bits.join(", ")}.` : "Uploaded. Everything already matched the sheet.";
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
