"use client";
// Admin libraries: predefined checklists and schedules, task categories, HK/SHK ideal counts, clusters.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCategory, applyClusterSheet, archiveCategory, archiveCluster, deleteChecklistPreset, MappingPlan, MappingRow, previewClusterSheet, deleteSchedulePreset, moveCategory, PresetItem, saveChecklistPreset, saveCluster, saveCounts, saveSchedulePreset } from "@/app/admin-actions";
import { DAYS, describeWhen, ItemCard } from "@/components/TemplateEditor";
import { Table } from "@/components/cc/parts";
import { RowActions } from "@/components/ui/RowActions";
import { readWorkbook } from "@/app/map-actions";
import { parseCsv } from "@/lib/sheet";
import { toCsv, toXlsx } from "@/lib/template";

type R = { ok: true; msg?: string } | { ok: false; error: string };
const parse = <X,>(s: string, d: X): X => { try { return JSON.parse(s); } catch { return d; } };
function useRun(notify: (m: string) => void) {
  const router = useRouter();
  return async (p: Promise<R>) => { const r = await p; notify(r.ok ? r.msg ?? "Saved" : r.error); if (r.ok) router.refresh(); return r.ok; };
}

export type Checklist = { id: number; title: string; items: string };
export function Checklists({ rows, notify }: { rows: Checklist[]; notify: (m: string) => void }) {
  const run = useRun(notify);
  const [edit, setEdit] = useState<{ id: number | null; title: string; items: PresetItem[] } | null>(null);
  const blank: PresetItem = { label: "", kind: "check", photo_allowed: true, photo_required: false, note_allowed: true, note_required: false, count_of: null };
  const setItem = (i: number, p: Partial<PresetItem>) => setEdit((e) => e && { ...e, items: e.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <section className="grid" style={{ gap: 10 }}>
      <div className="row2"><p className="small muted" style={{ margin: 0 }}>Reusable checklists. Load one into a task from the task editor&apos;s Checklist step.</p><span className="spacer" />
        <button type="button" className="btn primary sm" onClick={() => setEdit({ id: null, title: "", items: [blank] })}>+ New checklist</button></div>
      {edit && <div className="card grid">
        <label className="f">Checklist title<input type="text" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Room readiness" /></label>
        <div className="te-items">{edit.items.map((it, i) => (
          <ItemCard key={i} ix={i} it={it} last={i === edit.items.length - 1} onChange={(patch) => setItem(i, patch)}
            onMove={(d) => { const j = i + d; if (j < 0 || j >= edit.items.length) return; const xs = [...edit.items]; [xs[i], xs[j]] = [xs[j], xs[i]]; setEdit({ ...edit, items: xs }); }}
            onRemove={() => setEdit({ ...edit, items: edit.items.filter((_, j) => j !== i) })} />
        ))}</div>
        <div className="row2"><button type="button" className="btn sm" onClick={() => setEdit({ ...edit, items: [...edit.items, blank] })}>+ Add item</button><span className="spacer" />
          <button type="button" className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className="btn primary sm" onClick={async () => { if (await run(saveChecklistPreset(edit.id, edit.title, edit.items))) setEdit(null); }}>Save checklist</button></div>
      </div>}
      <Table<Checklist> name="Predefined checklists" rows={rows} rowKey={(c) => c.id} cols={[
        { key: "title", label: "Checklist", value: (c) => c.title, sticky: true, render: (c) => <b>{c.title}</b> },
        { key: "n", label: "Items", num: true, value: (c) => parse<unknown[]>(c.items, []).length },
        { key: "ph", label: "Photo compulsory", num: true, value: (c) => parse<PresetItem[]>(c.items, []).filter((i) => i.photo_required).length },
      ]} actions={(c) => [
        { label: "Edit", onClick: () => setEdit({ id: c.id, title: c.title, items: parse<PresetItem[]>(c.items, []).map((i) => ({ ...blank, ...i })) }) },
        { label: "Delete", danger: true, confirm: `Delete ${c.title}?`, onClick: () => run(deleteChecklistPreset(c.id)) },
      ]} />
    </section>
  );
}

export type Schedule = { id: number; name: string; frequency: string; days: string; once_date: string | null; window_start: string; window_end: string };
export function Schedules({ rows, notify }: { rows: Schedule[]; notify: (m: string) => void }) {
  const run = useRun(notify);
  const [edit, setEdit] = useState<(Omit<Schedule, "id" | "days"> & { id: number | null; days: number[] }) | null>(null);
  const toggle = (d: number) => edit && setEdit({ ...edit, days: edit.days.includes(d) ? edit.days.filter((x) => x !== d) : [...edit.days, d].sort((a, b) => a - b) });
  return (
    <section className="grid" style={{ gap: 10 }}>
      <div className="row2"><p className="small muted" style={{ margin: 0 }}>Reusable schedules. Pick one in the task editor to fill the time and repeat settings.</p><span className="spacer" />
        <button type="button" className="btn primary sm" onClick={() => setEdit({ id: null, name: "", frequency: "daily", days: [], once_date: null, window_start: "09:00", window_end: "10:00" })}>+ New schedule</button></div>
      {edit && <div className="card grid">
        <div className="te-row">
          <label className="f">Schedule name<input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Weekends" /></label>
          <label className="f">Repeats<select value={edit.frequency} onChange={(e) => setEdit({ ...edit, frequency: e.target.value, days: e.target.value === "weekly" || e.target.value === "monthly" ? [1] : [] })}>
            <option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          {edit.frequency === "once" && <label className="f">Date<input type="date" value={edit.once_date ?? ""} onChange={(e) => setEdit({ ...edit, once_date: e.target.value })} /></label>}
          <label className="f">Start time<input type="time" value={edit.window_start} onChange={(e) => setEdit({ ...edit, window_start: e.target.value })} /></label>
          <label className="f">End time<input type="time" value={edit.window_end} onChange={(e) => setEdit({ ...edit, window_end: e.target.value })} /></label>
        </div>
        {edit.frequency === "weekly" && <div className="te-days">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={edit.days.includes(i)} onClick={() => toggle(i)}>{d}</button>)}</div>}
        {edit.frequency === "monthly" && <div className="te-days te-month">{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <button key={d} type="button" aria-pressed={edit.days.includes(d)} onClick={() => toggle(d)}>{d}</button>)}</div>}
        <div className="row2"><span className="spacer" /><button type="button" className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className="btn primary sm" onClick={async () => { if (await run(saveSchedulePreset(edit.id, edit))) setEdit(null); }}>Save schedule</button></div>
      </div>}
      <Table<Schedule> name="Predefined schedules" rows={rows} rowKey={(s) => s.id} cols={[
        { key: "name", label: "Schedule", value: (s) => s.name, sticky: true, render: (s) => <b>{s.name}</b> },
        { key: "when", label: "Runs", value: (s) => describeWhen({ ...s, trigger: "scheduled", events: "[]", event_name: null }) },
      ]} actions={(s) => [
        { label: "Edit", onClick: () => setEdit({ ...s, days: parse<number[]>(s.days, []) }) },
        { label: "Delete", danger: true, confirm: `Delete ${s.name}?`, onClick: () => run(deleteSchedulePreset(s.id)) },
      ]} />
    </section>
  );
}

export type Category = { id: number; name: string; archived: number; used: number };
export function Categories({ rows, notify }: { rows: Category[]; notify: (m: string) => void }) {
  const run = useRun(notify);
  const [name, setName] = useState("");
  const live = rows.filter((c) => !c.archived), old = rows.filter((c) => c.archived);
  return (
    <section className="grid" style={{ gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>The order here is the order in the task editor. Archived categories stay on existing tasks and reports but can&apos;t be picked for new ones.</p>
      <form className="row2" onSubmit={async (e) => { e.preventDefault(); if (await run(addCategory(name))) setName(""); }}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" aria-label="New category name" style={{ flex: "1 1 220px" }} />
        <button className="btn primary sm">Add category</button>
      </form>
      <Table<Category & { n: number }> name="Categories" rows={live.map((c, i) => ({ ...c, n: i + 1 }))} rowKey={(c) => c.id} search={(c) => c.name}
        empty="No categories yet, so every task is Uncategorised." cols={[
          { key: "n", label: "#", value: (c) => c.n },
          { key: "name", label: "Category", value: (c) => c.name, render: (c) => <b>{c.name}</b>, sticky: true },
          { key: "used", label: "Tasks", num: true, value: (c) => c.used },
        ]} actions={(c) => [
          { label: "Move up", hidden: c.n === 1, onClick: () => run(moveCategory(c.id, -1)) },
          { label: "Move down", hidden: c.n === live.length, onClick: () => run(moveCategory(c.id, 1)) },
          { label: "Archive", danger: true, onClick: () => run(archiveCategory(c.id, true)) },
        ]} />
      {old.length > 0 && <details><summary className="small">Archived ({old.length})</summary>
        <div className="card lib-list" style={{ marginTop: 8 }}>{old.map((c) => <div key={c.id} className="lib-row"><span>{c.name}</span><span className="spacer" /><button type="button" className="link" onClick={() => run(archiveCategory(c.id, false))}>Restore</button></div>)}</div>
      </details>}
    </section>
  );
}

export type Count = { property_id: number; zolo: string; city: string; name: string; ideal_hk: number | null; ideal_shk: number | null; current_hk: number | null; current_shk: number | null };
export function Counts({ rows, notify }: { rows: Count[]; notify: (m: string) => void }) {
  const run = useRun(notify);
  const [show, setShow] = useState<"all" | "with" | "without">("all");
  const [draft, setDraft] = useState<Record<number, { hk: string; shk: string }>>({});
  const has = (r: Count) => r.ideal_hk !== null;
  const list = rows.filter((r) => show === "all" || (show === "with") === has(r));
  const changed = Object.entries(draft).map(([k, v]) => ({ property_id: Number(k), ideal_hk: v.hk === "" ? null : Number(v.hk), ideal_shk: v.shk === "" ? null : Number(v.shk) }));
  const val = (r: Count, k: "hk" | "shk") => draft[r.property_id]?.[k] ?? String((k === "hk" ? r.ideal_hk : r.ideal_shk) ?? "");
  const put = (r: Count, k: "hk" | "shk", v: string) => setDraft((d) => ({ ...d, [r.property_id]: { ...(d[r.property_id] ?? { hk: val(r, "hk"), shk: val(r, "shk") }), [k]: v } }));
  function download() {
    const csv = ["Zolo Code,City Name,Property name,HK Ideal Count,SHK Ideal Count", ...rows.map((r) => [r.zolo, r.city, `"${r.name}"`, r.ideal_hk ?? "", r.ideal_shk ?? ""].join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "hk-shk-ideal-counts.csv"; a.click();
  }
  async function upload(f: File | undefined) {
    if (!f) return;
    const lines = (await f.text()).split(/\r?\n/).slice(1).filter((l) => l.trim());
    const cells = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
    const out: { property_id: number; ideal_hk: number | null; ideal_shk: number | null }[] = [];
    let skipped = 0;
    for (const l of lines) {
      const [code, , name, hk, shk] = cells(l);
      const r = rows.find((x) => x.zolo === code) ?? rows.find((x) => x.name.toLowerCase() === (name ?? "").toLowerCase());
      if (!r) { skipped++; continue; }
      out.push({ property_id: r.property_id, ideal_hk: hk ? Number(hk) : null, ideal_shk: shk ? Number(shk) : null });
    }
    if (await run(saveCounts(out)) && skipped) notify(`Saved. ${skipped} row${skipped > 1 ? "s" : ""} didn't match a property and were skipped.`);
  }
  return (
    <section className="grid" style={{ gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>Ideal HK and SHK counts per property. Review checks staff-count items against them, and the dashboard shows who is still to be hired.</p>
      <div className="row2">
        <div className="seg" role="group" aria-label="Show">
          {([["all", `All (${rows.length})`], ["with", `With counts (${rows.filter(has).length})`], ["without", `Without (${rows.filter((r) => !has(r)).length})`]] as const).map(([k, l]) =>
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={download}>Download sheet</button>
        <label className="btn sm" style={{ cursor: "pointer" }}>Upload sheet<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <button type="button" className="btn primary sm" disabled={!changed.length} onClick={async () => { if (await run(saveCounts(changed))) setDraft({}); }}>Save {changed.length ? `(${changed.length})` : ""}</button>
      </div>
      <Table<Count> name="HK and SHK counts" rows={list} rowKey={(r) => r.property_id} search={(r) => `${r.name} ${r.city} ${r.zolo}`} cols={[
        { key: "name", label: "Property", value: (r) => r.name, sticky: true, render: (r) => <span><b>{r.name}</b><div className="small muted">{r.zolo} · {r.city}</div></span> },
        { key: "hk", label: "HK ideal", num: true, value: (r) => r.ideal_hk, render: (r) => <input type="number" min={0} className="cnt" value={val(r, "hk")} onChange={(e) => put(r, "hk", e.target.value)} aria-label={`HK ideal for ${r.name}`} /> },
        { key: "chk", label: "HK now", num: true, value: (r) => r.current_hk },
        { key: "shk", label: "SHK ideal", num: true, value: (r) => r.ideal_shk, render: (r) => <input type="number" min={0} className="cnt" value={val(r, "shk")} onChange={(e) => put(r, "shk", e.target.value)} aria-label={`SHK ideal for ${r.name}`} /> },
        { key: "cshk", label: "SHK now", num: true, value: (r) => r.current_shk },
      ]} />
      <p className="small muted" style={{ margin: 0 }}>Sheet columns: Zolo Code, City Name, Property name, HK Ideal Count, SHK Ideal Count. A blank cell keeps the saved number.</p>
    </section>
  );
}

export type Cluster = { id: number; name: string; city_id: number; city: string; reviewer_id: number | null; auditor_id: number | null; archived: number; props: string | null; n: number };
export function Clusters({ rows, cities, props, reviewers, auditors, notify }: {
  rows: Cluster[]; cities: { id: number; name: string }[]; props: { id: number; name: string; city_id: number; cluster_id: number }[];
  reviewers: { id: number; name: string }[]; auditors: { id: number; name: string }[]; notify: (m: string) => void;
}) {
  const run = useRun(notify);
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [bulk, setBulk] = useState(false);
  const [edit, setEdit] = useState<{ id: number | null; name: string; city_id: number; reviewer_id: number | null; auditor_id: number | null; properties: number[] } | null>(null);
  const name = (l: { id: number; name: string }[], id: number | null) => l.find((x) => x.id === id)?.name ?? "—";
  return (
    <section className="grid" style={{ gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>Clusters group properties in a city and drive the dashboard&apos;s City and Cluster filters. A cluster&apos;s reviewer and auditor take review work for tasks that don&apos;t name their own.</p>
      <div className="row2">
        <div className="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={tab === "active"} onClick={() => setTab("active")}>Active ({rows.filter((c) => !c.archived).length})</button>
          <button type="button" aria-pressed={tab === "archived"} onClick={() => setTab("archived")}>Archived ({rows.filter((c) => c.archived).length})</button>
        </div>
        <span className="spacer" />
        <button type="button" className="btn sm" aria-pressed={bulk} onClick={() => { setBulk(!bulk); setEdit(null); }}>Bulk upload</button>
        <button type="button" className="btn primary sm" onClick={() => { setBulk(false); setEdit({ id: null, name: "", city_id: cities[0]?.id ?? 0, reviewer_id: null, auditor_id: null, properties: [] }); }}>+ New cluster</button>
      </div>
      {bulk && <ClusterUpload notify={notify} onDone={() => setBulk(false)} />}
      {edit && <div className="card grid">
        <div className="te-row">
          <label className="f">Cluster name<input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="f">City<select value={edit.city_id} onChange={(e) => setEdit({ ...edit, city_id: Number(e.target.value), properties: [] })}>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="f">Default reviewer<select value={edit.reviewer_id ?? ""} onChange={(e) => setEdit({ ...edit, reviewer_id: e.target.value ? Number(e.target.value) : null })}><option value="">None</option>{reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="f">Default auditor<select value={edit.auditor_id ?? ""} onChange={(e) => setEdit({ ...edit, auditor_id: e.target.value ? Number(e.target.value) : null })}><option value="">None</option>{auditors.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        </div>
        <div className="f">Properties<div className="te-checks">{props.filter((p) => p.city_id === edit.city_id).map((p) => (
          <label key={p.id} className="opt"><input type="checkbox" checked={edit.properties.includes(p.id)} onChange={(e) => setEdit({ ...edit, properties: e.target.checked ? [...edit.properties, p.id] : edit.properties.filter((x) => x !== p.id) })} />{p.name}
            {p.cluster_id !== edit.id && <small>{rows.find((c) => c.id === p.cluster_id)?.name}</small>}</label>))}</div>
          <span className="small muted" style={{ fontWeight: 400 }}>Ticking a property moves it here from its current cluster.</span></div>
        <div className="row2"><span className="spacer" /><button type="button" className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className="btn primary sm" onClick={async () => { if (await run(saveCluster(edit.id, edit))) setEdit(null); }}>Save cluster</button></div>
      </div>}
      <Table<Cluster> name="Clusters" rows={rows.filter((c) => (tab === "archived") === !!c.archived)} rowKey={(c) => c.id} search={(c) => `${c.name} ${c.city} ${c.props ?? ""}`} cols={[
        { key: "name", label: "Cluster", value: (c) => c.name, sticky: true, render: (c) => <b>{c.name}</b> },
        { key: "city", label: "City", value: (c) => c.city },
        { key: "n", label: "Properties", num: true, value: (c) => c.n, render: (c) => <span title={c.props ?? ""}>{c.n}</span> },
        { key: "rv", label: "Reviewer", person: true, value: (c) => name(reviewers, c.reviewer_id) },
        { key: "au", label: "Auditor", person: true, value: (c) => name(auditors, c.auditor_id) },
      ]} actions={(c) => [
        { label: "Edit", hidden: !!c.archived, onClick: () => setEdit({ id: c.id, name: c.name, city_id: c.city_id, reviewer_id: c.reviewer_id, auditor_id: c.auditor_id, properties: props.filter((p) => p.cluster_id === c.id).map((p) => p.id) }) },
        { label: c.archived ? "Restore" : "Archive", danger: !c.archived, onClick: () => run(archiveCluster(c.id, !c.archived)) },
      ]} />
    </section>
  );
}

// Bulk cluster mapping: download the template, upload the filled sheet, check the preview, then apply.
const MAP_COLS = ["Zolo Code", "City Name", "Cluster Name", "Property name", "Reviewer Name", "Auditor Name"];
const MAP_EXAMPLE = [
  ["ZP049", "Pune", "Pune Kharadi 1", "Zolo Avalon (example, delete this row)", "reviewer.name@zolostays.com", "auditor.name@zolostays.com"],
  ["ZP040", "Pune", "Pune Kharadi 1", "Zolo Hendrix (example, delete this row)", "reviewer.name@zolostays.com", "auditor.name@zolostays.com"],
];
const MAP_FIND: [keyof Omit<MappingRow, "line">, RegExp][] = [
  ["code", /zolo.?code|property.?code|^code$/], ["city", /city/], ["cluster", /cluster/], ["property", /property.?name|^property$|^name$/],
  ["reviewer", /reviewer/], ["auditor", /auditor/],
];
function readMapping(rows: string[][]): MappingRow[] | string {
  const head = (rows[0] ?? []).map((h) => h.replace(/^\uFEFF/, "").trim().toLowerCase());
  const at = Object.fromEntries(MAP_FIND.map(([k, re]) => [k, head.findIndex((h) => re.test(h))])) as Record<keyof Omit<MappingRow, "line">, number>;
  const missing = (["city", "cluster", "property"] as const).filter((k) => at[k] < 0);
  if (missing.length) return `The sheet needs these columns: ${missing.map((k) => MAP_COLS[["code", "city", "cluster", "property"].indexOf(k)]).join(", ")}. Download the template to see the layout.`;
  const get = (r: string[], k: keyof typeof at) => (at[k] >= 0 ? (r[at[k]] ?? "").trim() : "");
  return rows.slice(1).map((r, i) => ({ line: i + 2, code: get(r, "code"), city: get(r, "city"), cluster: get(r, "cluster"), property: get(r, "property"), reviewer: get(r, "reviewer"), auditor: get(r, "auditor") }))
    .filter((r) => (r.city || r.cluster || r.property) && !/delete this row/i.test(r.property));
}

function ClusterUpload({ notify, onDone }: { notify: (m: string) => void; onDone: () => void }) {
  const run = useRun(notify);
  const [file, setFile] = useState(""), [rows, setRows] = useState<MappingRow[]>([]);
  const [plan, setPlan] = useState<MappingPlan | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [addPeople, setAddPeople] = useState(true);
  function template(kind: "xlsx" | "csv") {
    const data = [MAP_COLS, ...MAP_EXAMPLE];
    const blob = kind === "xlsx" ? new Blob([toXlsx("Cluster mapping", data, [12, 14, 20, 34, 30, 30]) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) : new Blob([toCsv(data)], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cluster-mapping-template.${kind}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function preview(r: MappingRow[], people: boolean) {
    setBusy(true);
    const res = await previewClusterSheet(r, people).catch((e: Error) => ({ ok: false as const, error: e.message }));
    setBusy(false);
    if (res.ok) { setPlan(res.plan); setErr(""); } else { setPlan(null); setErr(res.error); }
  }
  async function pick(f: File | undefined) {
    if (!f) return;
    setFile(f.name); setPlan(null); setErr("");
    let table: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      const fd = new FormData(); fd.append("file", f);
      setBusy(true);
      const r = await readWorkbook(fd).catch((e: Error) => ({ ok: false as const, error: e.message }));
      setBusy(false);
      if (!r.ok) { setErr(r.error); return; }
      table = r.rows;
    } else if (/\.(csv|txt)$/i.test(f.name)) table = parseCsv((await f.text()).replace(/^\uFEFF/, ""));
    else { setErr("Upload the sheet as Excel (.xlsx) or CSV."); return; }
    const m = readMapping(table);
    if (typeof m === "string") { setErr(m); return; }
    setRows(m);
    await preview(m, addPeople);
  }
  const changes = plan ? plan.newClusters.length + plan.restored.length + plan.leads.length + plan.moves.length + plan.newProps.length + (addPeople ? plan.newPeople.length : 0) : 0;
  const tile = (n: number, label: string, tone = "") => <div className={`cu-tile ${n ? tone : "zero"}`}><b>{n}</b><span>{label}</span></div>;
  const list = (title: string, items: string[]) => items.length > 0 && <details className="cu-list"><summary>{title} ({items.length})</summary><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></details>;
  return (
    <div className="card grid cu">
      <div className="row2"><h3 className="te-h" style={{ margin: 0, fontSize: 15 }}>Bulk upload clusters</h3><span className="spacer" /><button type="button" className="link small" onClick={onDone}>Close</button></div>
      <ol className="cu-steps">
        <li><b>Download the template</b><span className="small muted">One row per property. Reviewer and auditor are email addresses. The example rows are skipped if you leave them in.</span>
          <div className="row2"><button type="button" className="btn sm" onClick={() => template("xlsx")}>Excel template</button><button type="button" className="btn sm" onClick={() => template("csv")}>CSV template</button></div>
          <div className="chips">{MAP_COLS.map((c) => <span key={c} className="chipn small">{c}</span>)}</div></li>
        <li><b>Upload the filled sheet</b><span className="small muted">Nothing changes yet. You will see what the sheet does first.</span>
          <div className="row2"><label className="btn sm primary" style={{ cursor: "pointer" }}>{busy ? "Reading…" : file ? "Choose another file" : "Choose Excel or CSV file"}<input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
            {file && <span className="small muted">{file}{rows.length ? ` · ${rows.length} rows` : ""}</span>}</div></li>
        <li><b>Check and apply</b>
          {err && <div className="err">{err}</div>}
          {!plan && !err && <span className="small muted">The preview appears here after you upload.</span>}
          {plan && <>
            <div className="cu-tiles">
              {tile(plan.newClusters.length, "new clusters", "b")}
              {tile(plan.moves.length, "properties moved", "a")}
              {tile(plan.newProps.length, "new properties", "b")}
              {tile(plan.leads.length, "reviewer / auditor changes", "b")}
              {tile(plan.newCities.length, "new cities", "b")}
              {tile(plan.same, "already in place", "g")}
            </div>
            {list("New clusters", plan.newClusters)}
            {list("Restored from archive", plan.restored)}
            {list("Properties moving", plan.moves.map((m) => `${m.property}: ${m.from} → ${m.to}`))}
            {list("New properties", plan.newProps.map((m) => `${m.property} → ${m.cluster}`))}
            {list("Reviewer and auditor", plan.leads.map((l) => `${l.cluster}: ${[l.reviewer && `reviewer ${l.reviewer}`, l.auditor && `auditor ${l.auditor}`].filter(Boolean).join(", ")}`))}
            {plan.newPeople.length > 0 && <div className="cu-people">
              <label className="switch"><input type="checkbox" checked={addPeople} onChange={(e) => { setAddPeople(e.target.checked); void preview(rows, e.target.checked); }} />Add {plan.newPeople.length} {plan.newPeople.length === 1 ? "person" : "people"} not in ZoTask yet</label>
              <div className="chips">{plan.newPeople.map((n) => <span key={n.email} className="chipn small">{n.name} · {n.role} · {n.email}</span>)}</div>
              {!addPeople && <span className="small muted">Their clusters keep the reviewer or auditor they have now.</span>}
            </div>}
            {plan.problems.length > 0 && <div className="te-gaps warn"><b>{plan.problems.length} row{plan.problems.length > 1 ? "s" : ""} to check</b><ul>{plan.problems.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}{plan.problems.length > 20 && <li>…and {plan.problems.length - 20} more</li>}</ul></div>}
            <div className="row2"><span className="spacer" /><button type="button" className="btn sm" onClick={onDone}>Cancel</button>
              <button type="button" className="btn primary sm" disabled={busy || !changes} onClick={async () => { setBusy(true); const ok = await run(applyClusterSheet(rows, addPeople)); setBusy(false); if (ok) onDone(); }}>
                {changes ? `Apply ${changes} change${changes > 1 ? "s" : ""}` : "Nothing to change"}</button></div>
          </>}
        </li>
      </ol>
    </div>
  );
}
