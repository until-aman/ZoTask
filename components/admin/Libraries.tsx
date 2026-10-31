"use client";
// Admin libraries: predefined checklists and schedules, task categories, HK/SHK ideal counts, clusters.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCategory, archiveCategory, archiveCluster, deleteChecklistPreset, deleteSchedulePreset, moveCategory, PresetItem, saveChecklistPreset, saveCluster, saveCounts, saveSchedulePreset } from "@/app/admin-actions";
import { DAYS, describeWhen } from "@/components/TemplateEditor";
import { Table } from "@/components/cc/parts";
import { RowActions } from "@/components/ui/RowActions";

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
        {edit.items.map((it, i) => (
          <div key={i} className="te-item">
            <span className="te-n">{i + 1}</span>
            <input type="text" value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} placeholder="Add a checklist item" aria-label={`Item ${i + 1}`} />
            <select value={it.kind === "count" ? `count:${it.count_of}` : it.kind} aria-label="Answer" onChange={(e) => { const v = e.target.value; setItem(i, v.startsWith("count:") ? { kind: "count", count_of: v.slice(6) } : { kind: v, count_of: null }); }}>
              <option value="check">Tick box</option><option value="number">Number</option><option value="text">Text</option><option value="count:HK">Number of HKs</option><option value="count:SHK">Number of SHKs</option></select>
            <label className="te-rule">Photo<select value={it.photo_required ? "required" : it.photo_allowed ? "optional" : "off"} onChange={(e) => setItem(i, { photo_allowed: e.target.value !== "off", photo_required: e.target.value === "required" })}><option value="off">No</option><option value="optional">Optional</option><option value="required">Compulsory</option></select></label>
            <label className="te-rule">Note<select value={it.note_required ? "required" : it.note_allowed ? "optional" : "off"} onChange={(e) => setItem(i, { note_allowed: e.target.value !== "off", note_required: e.target.value === "required" })}><option value="off">No</option><option value="optional">Optional</option><option value="required">Compulsory</option></select></label>
            <span className="te-act"><button type="button" className="link" aria-label="Remove item" onClick={() => setEdit({ ...edit, items: edit.items.filter((_, j) => j !== i) })}>×</button></span>
          </div>
        ))}
        <div className="row2"><button type="button" className="btn sm" onClick={() => setEdit({ ...edit, items: [...edit.items, blank] })}>+ Add item</button><span className="spacer" />
          <button type="button" className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className="btn primary sm" onClick={async () => { if (await run(saveChecklistPreset(edit.id, edit.title, edit.items))) setEdit(null); }}>Save checklist</button></div>
      </div>}
      <Table<Checklist> name="Predefined checklists" rows={rows} rowKey={(c) => c.id} cols={[
        { key: "title", label: "Checklist", value: (c) => c.title, sticky: true, render: (c) => <b>{c.title}</b> },
        { key: "n", label: "Items", num: true, value: (c) => parse<unknown[]>(c.items, []).length },
        { key: "ph", label: "Photo compulsory", num: true, value: (c) => parse<PresetItem[]>(c.items, []).filter((i) => i.photo_required).length },
        { key: "act", label: "", value: () => null, csv: () => "", render: (c) => <RowActions name={c.title}
          onEdit={() => setEdit({ id: c.id, title: c.title, items: parse<PresetItem[]>(c.items, []).map((i) => ({ ...blank, ...i })) })} onDelete={() => run(deleteChecklistPreset(c.id))} /> },
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
        { key: "act", label: "", value: () => null, csv: () => "", render: (s) => <RowActions name={s.name}
          onEdit={() => setEdit({ ...s, days: parse<number[]>(s.days, []) })} onDelete={() => run(deleteSchedulePreset(s.id))} /> },
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
      <div className="card lib-list">
        {live.map((c, i) => (
          <div key={c.id} className="lib-row">
            <span className="te-n">{i + 1}</span><b>{c.name}</b><span className="small muted">{c.used} task{c.used === 1 ? "" : "s"}</span><span className="spacer" />
            <button type="button" className="link" aria-label="Move up" disabled={i === 0} onClick={() => run(moveCategory(c.id, -1))}>↑</button>
            <button type="button" className="link" aria-label="Move down" disabled={i === live.length - 1} onClick={() => run(moveCategory(c.id, 1))}>↓</button>
            <button type="button" className="link" onClick={() => run(archiveCategory(c.id, true))}>Archive</button>
          </div>
        ))}
        {!live.length && <div className="muted small">No categories yet, so every task is Uncategorised.</div>}
      </div>
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
        <button type="button" className="btn primary sm" onClick={() => setEdit({ id: null, name: "", city_id: cities[0]?.id ?? 0, reviewer_id: null, auditor_id: null, properties: [] })}>+ New cluster</button>
      </div>
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
        { key: "rv", label: "Reviewer", value: (c) => name(reviewers, c.reviewer_id) },
        { key: "au", label: "Auditor", value: (c) => name(auditors, c.auditor_id) },
        { key: "act", label: "", value: () => null, csv: () => "", render: (c) => <span className="row2" style={{ gap: 10, justifyContent: "flex-end" }}>
          {!c.archived && <button type="button" className="link" onClick={() => setEdit({ id: c.id, name: c.name, city_id: c.city_id, reviewer_id: c.reviewer_id, auditor_id: c.auditor_id, properties: props.filter((p) => p.cluster_id === c.id).map((p) => p.id) })}>Edit</button>}
          <button type="button" className="link" onClick={() => run(archiveCluster(c.id, !c.archived))}>{c.archived ? "Restore" : "Archive"}</button></span> },
      ]} />
    </section>
  );
}
