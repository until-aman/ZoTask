// The cluster sheet: one row per property naming its city, cluster, the cluster's reviewer and auditor, and the property's CBM.
// Uploading it makes the clusters match the file exactly. Pure functions, so the browser can build the download
// and the server can plan an upload without touching the database.

export type Snapshot = {
  cities: { id: number; name: string }[];
  clusters: { id: number; name: string; city_id: number; reviewer_id: number | null; auditor_id: number | null; archived: number }[];
  properties: { id: number; name: string; cluster_id: number; cbm_id: number | null }[];
  people: { id: number; name: string; email: string | null; access_role: string }[];
};

/** A cluster in the plan: an existing id, or a new cluster by its position in `create`. */
export type ClusterRef = number | `new:${number}`;
export type ClusterPlan = {
  errors: string[];
  create: { ref: ClusterRef; name: string; city_id: number; city: string; reviewer_id: number | null; auditor_id: number | null; properties: number }[];
  update: { id: number; name: string; city: string; reviewer_id: number | null; auditor_id: number | null; changes: string[] }[];
  archive: { id: number; name: string; city: string }[];
  moves: { property_id: number; property: string; from: string; to: string; ref: ClusterRef }[];
  same: number;
  /** CBMs the sheet adds; `cbms` points at one as `new:<index>`. */
  newCbms: { name: string; email: string | null }[];
  cbms: { property_id: number; property: string; from: string; to: string; cbm: number | `new:${number}` | null }[];
};

export const SHEET_COLS = ["City", "Cluster", "Reviewer", "Auditor", "Property", "Zolo Code", "CBM"];
export const zoloCode = (id: number) => `ZO${String(id).padStart(4, "0")}`;
const low = (s: string) => s.trim().toLowerCase();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const nameFromEmail = (e: string) => e.split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** The current clusters as a sheet: every active cluster and its properties, one row per property. CBMs go by email when known. */
export function sheetRows(s: Snapshot): string[][] {
  const name = (id: number | null) => s.people.find((p) => p.id === id)?.name ?? "";
  const cbm = (id: number | null) => { const p = s.people.find((x) => x.id === id); return p ? p.email || p.name : ""; };
  const city = (id: number) => s.cities.find((c) => c.id === id)?.name ?? "";
  const out: string[][] = [];
  const active = s.clusters.filter((c) => !c.archived).sort((a, b) => city(a.city_id).localeCompare(city(b.city_id)) || a.name.localeCompare(b.name));
  for (const c of active) {
    const lead = [city(c.city_id), c.name, name(c.reviewer_id), name(c.auditor_id)];
    const props = s.properties.filter((p) => p.cluster_id === c.id).sort((a, b) => a.name.localeCompare(b.name));
    if (!props.length) out.push([...lead, "", "", ""]);
    for (const p of props) out.push([...lead, p.name, zoloCode(p.id), cbm(p.cbm_id)]);
  }
  return [SHEET_COLS, ...out];
}

const isProp = (h: string) => h.includes("property") && !h.includes("code");
const isCbm = (h: string) => h.includes("cbm") || h.includes("business manager");
const FIND: [keyof typeof COLS, (h: string) => boolean][] = [
  ["city", (h) => h.includes("city")], ["cluster", (h) => h.includes("cluster") && !isCbm(h)],
  ["reviewer", (h) => h.includes("reviewer")], ["auditor", (h) => h.includes("auditor")],
  ["property", isProp], ["code", (h) => h.includes("code")], ["cbm", isCbm],
];
const COLS = { city: "City", cluster: "Cluster", reviewer: "Reviewer", auditor: "Auditor", property: "Property", code: "Zolo Code", cbm: "CBM" };

/**
 * What uploading these rows (the whole table, header included) would change. Anything in `errors` blocks the upload.
 * A cluster is found by city and name; a cluster under a new name that takes most of its properties from one
 * existing cluster the file no longer names is that cluster renamed. Active clusters the file leaves out are archived.
 */
export function planClusters(table: string[][], s: Snapshot): ClusterPlan {
  const plan: ClusterPlan = { errors: [], create: [], update: [], archive: [], moves: [], same: 0, newCbms: [], cbms: [] };
  const err = (m: string) => { plan.errors.push(m); };

  // 1. Header: the first row naming both Cluster and Property. Columns go by name, in any order.
  const hi = table.findIndex((r) => r.some((c) => low(c).includes("cluster")) && r.some((c) => isProp(low(c))));
  if (hi < 0) { err(`The sheet needs a header row with these columns: ${SHEET_COLS.join(", ")}.`); return plan; }
  const head = table[hi].map((c) => low(c.replace(/^﻿/, "")));
  const at = Object.fromEntries(FIND.map(([k, f]) => [k, head.findIndex(f)])) as Record<keyof typeof COLS, number>;
  // CBM is optional: without the column, CBMs stay as they are.
  const missing = (Object.keys(COLS) as (keyof typeof COLS)[]).filter((k) => k !== "cbm" && at[k] < 0);
  if (missing.length) { err(`The sheet is missing these columns: ${missing.map((k) => COLS[k]).join(", ")}.`); return plan; }
  const rows = table.slice(hi + 1).map((r, i) => {
    const get = (k: keyof typeof COLS) => (at[k] >= 0 ? r[at[k]] ?? "" : "").trim();
    return { line: hi + i + 2, city: get("city"), cluster: get("cluster"), reviewer: get("reviewer"), auditor: get("auditor"), property: get("property"), code: get("code"), cbm: get("cbm") };
  }).filter((r) => r.city || r.cluster || r.reviewer || r.auditor || r.property || r.code || r.cbm);
  if (!rows.length) { err("The sheet has no rows under the header."); return plan; }

  const cityName = (id: number) => s.cities.find((c) => c.id === id)?.name ?? "";
  const clusterOf = (id: number) => s.clusters.find((c) => c.id === id);
  const personName = (id: number | null) => s.people.find((p) => p.id === id)?.name ?? "none";
  function person(v: string, role: "reviewer" | "auditor", line: number): number | null | undefined {
    if (!v) return null;
    const byEmail = s.people.filter((p) => p.email && low(p.email) === low(v));
    const found = byEmail.length ? byEmail : s.people.filter((p) => low(p.name) === low(v));
    const right = found.filter((p) => p.access_role === role);
    if (right.length === 1) return right[0].id;
    if (right.length > 1) err(`Row ${line}: more than one ${role} is called "${v}". Use their email instead.`);
    else if (found.length) err(`Row ${line}: ${found[0].name} is not a${role === "auditor" ? "n" : ""} ${role}.`);
    else err(`Row ${line}: no ${role} called "${v}".`);
    return undefined;
  }

  // 2. Group the rows into clusters, checking each row.
  type Want = { line: number; name: string; city_id: number; reviewer?: { id: number | null; line: number }; auditor?: { id: number | null; line: number }; props: number[] };
  const want = new Map<string, Want>();
  const seen = new Map<number, number>();
  const cbmRows: { line: number; prop: Snapshot["properties"][number]; v: string }[] = [];
  for (const r of rows) {
    if (!r.city || !r.cluster) { err(`Row ${r.line}: needs both a City and a Cluster.`); continue; }
    const city = s.cities.find((c) => low(c.name) === low(r.city));
    if (!city) { err(`Row ${r.line}: no city called "${r.city}".`); continue; }
    const key = `${city.id}|${low(r.cluster)}`;
    let w = want.get(key);
    if (!w) want.set(key, (w = { line: r.line, name: r.cluster, city_id: city.id, props: [] }));
    if (r.reviewer && low(r.reviewer) === low(r.auditor)) err(`Row ${r.line}: ${r.cluster} has the same person as reviewer and auditor.`);
    for (const role of ["reviewer", "auditor"] as const) {
      if (!r[role]) continue;
      const id = person(r[role], role, r.line);
      if (id === undefined) continue;
      const had = w[role];
      if (had && had.id !== id) err(`Row ${r.line}: ${r.cluster} has ${role} ${personName(id)}, but row ${had.line} gives ${personName(had.id)}.`);
      else if (!had) w[role] = { id, line: r.line };
    }
    if (!r.property && !r.code) continue;
    const m = /^zo0*(\d+)$/i.exec(r.code);
    const prop = (m && s.properties.find((p) => p.id === Number(m[1]))) || s.properties.find((p) => p.name.trim() === r.property);
    if (!prop) { err(`Row ${r.line}: no property ${r.code ? `with code ${r.code}` : `called "${r.property}"`}${r.code && r.property ? ` or called "${r.property}"` : ""}.`); continue; }
    const dup = seen.get(prop.id);
    if (dup) { err(`Row ${r.line}: ${prop.name} is already on row ${dup}.`); continue; }
    seen.set(prop.id, r.line);
    const pc = clusterOf(prop.cluster_id)?.city_id;
    if (pc !== city.id) { err(`Row ${r.line}: ${prop.name} is in ${cityName(pc ?? 0) || "another city"}, not ${city.name}.`); continue; }
    w.props.push(prop.id);
    if (at.cbm >= 0) cbmRows.push({ line: r.line, prop, v: r.cbm });
  }
  // Each property's CBM: an existing CBM by email or name, a new one, or none when the cell is blank.
  const added = new Map<string, number>();
  for (const { line, prop, v } of cbmRows) {
    let to: number | `new:${number}` | null = null;
    if (v) {
      const byEmail = s.people.filter((p) => p.email && low(p.email) === low(v));
      const found = byEmail.length ? byEmail : s.people.filter((p) => low(p.name) === low(v));
      const right = found.filter((p) => p.access_role === "cbm");
      if (right.length > 1) { err(`Row ${line}: more than one CBM is called "${v}". Use their email instead.`); continue; }
      if (!right.length && found.length) { err(`Row ${line}: ${found[0].name} is a${found[0].access_role === "admin" || found[0].access_role === "auditor" ? "n" : ""} ${found[0].access_role}, not a CBM.`); continue; }
      if (right.length) to = right[0].id;
      else {
        let ix = added.get(low(v));
        if (ix === undefined) {
          added.set(low(v), (ix = plan.newCbms.length));
          plan.newCbms.push(EMAIL.test(v) ? { name: nameFromEmail(v), email: v } : { name: v, email: null });
        }
        to = `new:${ix}`;
      }
    }
    if (to !== prop.cbm_id) plan.cbms.push({ property_id: prop.id, property: prop.name, from: personName(prop.cbm_id),
      to: typeof to === "string" ? `${plan.newCbms[Number(to.slice(4))].name} (new)` : personName(to), cbm: to });
  }
  for (const w of want.values())
    if (w.reviewer?.id && w.reviewer.id === w.auditor?.id) err(`Row ${w.auditor.line}: ${w.name} has the same person as reviewer and auditor.`);
  const left = s.properties.filter((p) => !seen.has(p.id));
  for (const p of left.slice(0, 20)) err(`${p.name} (${zoloCode(p.id)}) is missing. Every property must be in a cluster.`);
  if (left.length > 20) err(`…and ${left.length - 20} more properties are missing.`);

  // 3. Match each cluster in the file to an existing one: by city and name, else as a rename.
  const target = new Map<string, ClusterRef>();
  for (const [key, w] of want) {
    const c = s.clusters.find((x) => x.city_id === w.city_id && low(x.name) === low(w.name));
    if (c) target.set(key, c.id);
  }
  const named = new Set(target.values());
  for (const [key, w] of want) {
    if (target.has(key) || !w.props.length) continue;
    const from = new Map<number, number>();
    for (const id of w.props) { const c = s.properties.find((p) => p.id === id)!.cluster_id; from.set(c, (from.get(c) ?? 0) + 1); }
    const [best, n] = [...from].filter(([c]) => !named.has(c)).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (best !== undefined && n! * 2 > w.props.length) { target.set(key, best); named.add(best); }
  }

  // 4. The plan.
  for (const [key, w] of want) {
    const rv = w.reviewer?.id ?? null, au = w.auditor?.id ?? null;
    let ref = target.get(key);
    if (ref === undefined) {
      ref = `new:${plan.create.length}`;
      target.set(key, ref);
      plan.create.push({ ref, name: w.name, city_id: w.city_id, city: cityName(w.city_id), reviewer_id: rv, auditor_id: au, properties: w.props.length });
      continue;
    }
    const c = clusterOf(ref as number)!;
    const changes: string[] = [];
    if (c.name !== w.name) changes.push(`renamed from ${c.name}`);
    if (c.archived) changes.push("restored");
    if (c.reviewer_id !== rv) changes.push(`reviewer ${personName(c.reviewer_id)} → ${personName(rv)}`);
    if (c.auditor_id !== au) changes.push(`auditor ${personName(c.auditor_id)} → ${personName(au)}`);
    const had = s.properties.filter((p) => p.cluster_id === c.id).map((p) => p.id);
    const gain = w.props.filter((id) => !had.includes(id)).length, lose = had.filter((id) => !w.props.includes(id)).length;
    if (gain) changes.push(`+${gain} propert${gain > 1 ? "ies" : "y"}`);
    if (lose) changes.push(`−${lose} propert${lose > 1 ? "ies" : "y"}`);
    if (changes.length) plan.update.push({ id: c.id, name: w.name, city: cityName(w.city_id), reviewer_id: rv, auditor_id: au, changes });
    else plan.same++;
  }
  const kept = new Set([...target.values()]);
  for (const c of s.clusters) if (!c.archived && !kept.has(c.id)) plan.archive.push({ id: c.id, name: c.name, city: cityName(c.city_id) });
  for (const [key, w] of want) {
    const ref = target.get(key)!;
    for (const id of w.props) {
      const p = s.properties.find((x) => x.id === id)!;
      if (p.cluster_id !== ref) plan.moves.push({ property_id: id, property: p.name, from: clusterOf(p.cluster_id)?.name ?? "?", to: w.name, ref });
    }
  }
  return plan;
}
