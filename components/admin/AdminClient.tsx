"use client";
// Admin: task setup (with bulk actions), the libraries tasks draw on, and properties and people.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { copyTasksTo, deleteTasks, setTasksActive } from "@/app/admin-actions";
import { describeWhen } from "@/components/TemplateEditor";
import { RowActions } from "@/components/ui/RowActions";
import { Categories, Category, Checklist, Checklists, Cluster, Clusters, Count, Counts, Schedule, Schedules } from "./Libraries";
import { Table, type Col } from "@/components/cc/parts";
import { ActiveChip, Field, FilterBar, SavedView, Stats, sameFilters } from "@/components/ui/Filters";

export type Tpl = { id: number; name: string; category: string; op_role: string; trigger: string; event_name: string | null; frequency: string; window_start: string; window_end: string;
  review_sla_h: number; audit_sla_h: number; attempts_allowed: number; criticality: string; audit_rate: number; active: number; props: number; reviewer: string | null; auditor: string | null;
  events: string; days: string; once_date: string | null; review_required: number };
export type Prop = { id: number; name: string; cluster: string; city: string; cbm: string | null; staff: number; city_id: number; cluster_id: number };
type Lib = { checklists: Checklist[]; schedules: Schedule[]; categories: Category[]; counts: Count[]; clusters: Cluster[]; cities: { id: number; name: string }[];
  reviewers: { id: number; name: string }[]; auditors: { id: number; name: string }[] };
const TABS: [string, string][] = [["tasks", "Tasks"], ["checklists", "Checklists"], ["schedules", "Schedules"], ["categories", "Categories"], ["counts", "HK counts"], ["clusters", "Clusters"], ["people", "Properties & people"]];
const ROLE_NAME: Record<string, string> = { admin: "Admin", reviewer: "Reviewers", auditor: "Auditors", cbm: "CBMs", ground: "Ground team" };
const when = (t: Tpl) => describeWhen(t);

export default function AdminClient({ tab: tab0, templates, props, people, views, lib, children }: {
  tab: string; templates: Tpl[]; props: Prop[]; people: { access_role: string; n: number }[]; views: SavedView[]; lib: Lib; children: React.ReactNode;
}) {
  const router = useRouter();
  const [tab, setTabState] = useState(TABS.some(([k]) => k === tab0) ? tab0 : "tasks");
  useEffect(() => { if (TABS.some(([k]) => k === tab0)) setTabState(tab0); }, [tab0]);
  const setTab = (k: string) => { setTabState(k); router.replace(k === "tasks" ? "/admin" : `/admin?tab=${k}`); };
  const [sel, setSel] = useState<number[]>([]);
  const [copying, setCopying] = useState<number[] | null>(null);
  const [delAsk, setDelAsk] = useState(false);
  const bulk = async (p: Promise<{ ok: true; msg?: string } | { ok: false; error: string }>) => { const r = await p; setToast(r.ok ? r.msg ?? "Done" : r.error); if (r.ok) { setSel([]); router.refresh(); } return r.ok; };
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [role, setRole] = useState("");
  const [trig, setTrig] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  const current = { cat, role, trig, state, city };
  const apply = (f: Record<string, unknown>) => { const g = (k: string) => String(f[k] ?? ""); setCat(g("cat")); setRole(g("role")); setTrig(g("trig")); setState(g("state")); setCity(g("city")); };
  const def = views.find((v) => v.def);
  useEffect(() => { if (def && !sameFilters(def.f, current)) apply(def.f); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = [...new Set(templates.map((t) => t.category))].sort(), roles = [...new Set(templates.map((t) => t.op_role))].sort(), cities = [...new Set(props.map((p) => p.city))];
  const tpl = templates.filter((t) => (!cat || t.category === cat) && (!role || t.op_role === role) && (!trig || t.trigger === trig)
    && (!state || (state === "active" ? t.active : state === "paused" ? !t.active : t.criticality === "high")));
  const pr = props.filter((p) => !city || p.city === city);
  const chips: ActiveChip[] = [
    ...(cat ? [{ key: "cat", label: <>Category: <b>{cat}</b></>, clear: () => setCat("") }] : []),
    ...(role ? [{ key: "role", label: <>Role: <b>{role}</b></>, clear: () => setRole("") }] : []),
    ...(trig ? [{ key: "trig", label: <>Starts: <b>{trig === "scheduled" ? "On a schedule" : trig === "event" ? "On an event" : "On demand"}</b></>, clear: () => setTrig("") }] : []),
    ...(state ? [{ key: "state", label: <>Showing: <b>{state === "active" ? "Active" : state === "paused" ? "Paused" : "Critical"}</b></>, clear: () => setState("") }] : []),
    ...(city ? [{ key: "city", label: <>Properties in: <b>{city}</b></>, clear: () => setCity("") }] : []),
  ];

  const cols: Col<Tpl>[] = [
    { key: "sel", label: "", value: () => null, csv: () => "", render: (t) => <input type="checkbox" aria-label={`Select ${t.name}`} checked={sel.includes(t.id)} onChange={(e) => setSel(e.target.checked ? [...sel, t.id] : sel.filter((x) => x !== t.id))} /> },
    { key: "name", label: "Task", value: (t) => t.name, render: (t) => <span><b>{t.name}</b>{t.criticality === "high" && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}{!t.active && <span className="pill" style={{ marginLeft: 6 }}>Paused</span>}</span>, sticky: true },
    { key: "cat", label: "Category", value: (t) => t.category },
    { key: "role", label: "Role", value: (t) => t.op_role },
    { key: "when", label: "When", value: (t) => when(t) },
    { key: "win", label: "Window", value: (t) => t.window_start, render: (t) => `${t.window_start}–${t.window_end}`, csv: (t) => `${t.window_start}-${t.window_end}` },
    { key: "sla", label: "Review / audit SLA", num: true, value: (t) => t.review_sla_h, render: (t) => t.review_required ? `${t.review_sla_h}h / ${t.audit_sla_h}h` : "No review" },
    { key: "att", label: "Attempts", num: true, value: (t) => t.attempts_allowed },
    { key: "audit", label: "Audit sample", num: true, value: (t) => t.audit_rate, render: (t) => `${Math.round(t.audit_rate * 100)}%` },
    { key: "rv", label: "Reviewer / auditor", value: (t) => t.reviewer, render: (t) => <span className="small"><div>{t.reviewer ?? "Cluster reviewer"}</div><div className="muted">{t.auditor ?? "Any auditor"}</div></span>, csv: (t) => `${t.reviewer ?? ""} / ${t.auditor ?? ""}` },
    { key: "props", label: "Properties", num: true, value: (t) => t.props },
    { key: "edit", label: "", value: () => null, csv: () => "", render: (t) => <RowActions name={t.name} onEdit={() => router.push(`/admin/templates/${t.id}`)} onDelete={() => bulk(deleteTasks([t.id]))} /> },
  ];
  const pcols: Col<Prop>[] = [
    { key: "name", label: "Property", value: (p) => p.name, sticky: true },
    { key: "cluster", label: "Cluster", value: (p) => p.cluster },
    { key: "city", label: "City", value: (p) => p.city },
    { key: "cbm", label: "CBM", value: (p) => p.cbm },
    { key: "staff", label: "Ground staff", num: true, value: (p) => p.staff },
  ];
  const total = people.reduce((a, p) => a + p.n, 0);
  const cities2 = [...new Set(props.map((p) => p.city))];
  return (
    <div className="page">
      <div className="row2"><h1>Admin</h1><span className="spacer" /><Link className="btn primary" href="/admin/templates/new">+ New task</Link></div>
      <nav className="admtabs" aria-label="Admin sections">
        {TABS.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? "page" : undefined} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </nav>

      {tab === "tasks" && <>
        <FilterBar search={q} setSearch={setQ} searchLabel="Search tasks" chips={chips} onClearAll={() => apply({})}
          saved={{ page: "admin", views, current, apply, notify: setToast, name: [cat, role, city].filter(Boolean).join(" · ") || "Admin view" }}
          panel={<>
            <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{roles.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Starts"><select value={trig} onChange={(e) => setTrig(e.target.value)}><option value="">Any way</option><option value="scheduled">On a schedule</option><option value="event">On an event</option><option value="on_demand">On demand</option></select></Field>
            <Field label="Show"><select value={state} onChange={(e) => setState(e.target.value)}><option value="">All task types</option><option value="active">Active only</option><option value="paused">Paused only</option><option value="critical">Critical only</option></select></Field>
          </>} />
        <Stats compact items={[
          { key: "tasks", label: "Task types", value: templates.length, sub: `${templates.filter((t) => t.active).length} active · ${templates.filter((t) => !t.active).length} paused` },
          { key: "crit", label: "Critical task types", value: templates.filter((t) => t.criticality === "high").length, active: state === "critical", onClick: () => setState(state === "critical" ? "" : "critical") },
          { key: "props", label: "Properties", value: props.length, sub: `${cities.length} cities` },
          { key: "people", label: "People", value: total, sub: people.map((p) => `${p.n} ${ROLE_NAME[p.access_role]?.toLowerCase() ?? p.access_role}`).join(" · ") },
        ]} />
        <div className="row2 bulkbar">
          {sel.length ? <>
            <b>{sel.length} selected</b>
            <button type="button" className="btn sm" onClick={() => bulk(setTasksActive(sel, false))}>Pause</button>
            <button type="button" className="btn sm" onClick={() => bulk(setTasksActive(sel, true))}>Resume</button>
            <button type="button" className="btn sm" onClick={() => setCopying([])}>Add to properties</button>
            {delAsk ? <span className="row2 small" style={{ gap: 6 }}>Delete {sel.length}? Tasks that already ran are paused instead.
              <button type="button" className="btn sm danger" onClick={() => { setDelAsk(false); void bulk(deleteTasks(sel)); }}>Yes, delete</button>
              <button type="button" className="btn sm" onClick={() => setDelAsk(false)}>No</button></span>
              : <button type="button" className="btn sm" style={{ color: "var(--red)" }} onClick={() => setDelAsk(true)}>Delete</button>}
            <button type="button" className="link small" onClick={() => setSel([])}>Clear</button>
          </> : <span className="small muted">Tick tasks to pause, resume, add them to more properties, or delete them.</span>}
          <span className="spacer" />
          <button type="button" className="link small" onClick={() => setSel(tpl.map((t) => t.id))}>Select all {tpl.length}</button>
        </div>
        {copying && <div className="card grid">
          <div className="row2"><b>Add {sel.length} task{sel.length > 1 ? "s" : ""} to these properties</b><span className="spacer" />
            <button type="button" className="link small" onClick={() => setCopying(props.map((p) => p.id))}>All</button><button type="button" className="link small" onClick={() => setCopying([])}>None</button></div>
          <div className="grid g3" style={{ gap: 4 }}>
            {cities2.map((c) => <div key={c}><b className="small">{c}</b>{props.filter((p) => p.city === c).map((p) => (
              <label key={p.id} className="opt"><input type="checkbox" checked={copying.includes(p.id)} onChange={(e) => setCopying(e.target.checked ? [...copying, p.id] : copying.filter((x) => x !== p.id))} />{p.name}</label>))}</div>)}
          </div>
          <div className="row2"><span className="spacer" /><button type="button" className="btn sm" onClick={() => setCopying(null)}>Cancel</button>
            <button type="button" className="btn primary sm" disabled={!copying.length} onClick={async () => { if (await bulk(copyTasksTo(sel, copying))) setCopying(null); }}>Add to {copying.length} propert{copying.length === 1 ? "y" : "ies"}</button></div>
        </div>}
        <Table name="Task setup" rows={tpl} cols={cols} rowKey={(t) => t.id} query={q} empty="No task types match these filters." />
        {children}
      </>}
      {tab === "checklists" && <Checklists rows={lib.checklists} notify={setToast} />}
      {tab === "schedules" && <Schedules rows={lib.schedules} notify={setToast} />}
      {tab === "categories" && <Categories rows={lib.categories} notify={setToast} />}
      {tab === "counts" && <Counts rows={lib.counts} notify={setToast} />}
      {tab === "clusters" && <Clusters rows={lib.clusters} cities={lib.cities} props={props} reviewers={lib.reviewers} auditors={lib.auditors} notify={setToast} />}
      {tab === "people" && <>
        <FilterBar search={q} setSearch={setQ} searchLabel="Search properties" chips={city ? [{ key: "city", label: <>City: <b>{city}</b></>, clear: () => setCity("") }] : []}
          panel={<Field label="City"><select value={city} onChange={(e) => setCity(e.target.value)}><option value="">All cities</option>{cities.map((x) => <option key={x}>{x}</option>)}</select></Field>} />
        <div className="grid g2">
          <section className="grid" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>Properties</h2>
            <Table name="Properties" rows={pr} cols={pcols} rowKey={(p) => p.id} query={q} />
          </section>
          <section className="grid" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>People</h2>
            <Table name="People" rows={people} rowKey={(p) => p.access_role} cols={[
              { key: "role", label: "Role", value: (p) => ROLE_NAME[p.access_role] ?? p.access_role, sticky: true },
              { key: "n", label: "People", num: true, value: (p) => p.n },
            ]} />
            <p className="small muted" style={{ margin: 0 }}>Roles here are operational roles only (admin, reviewer, auditor, CBM, ground team), not system access roles.</p>
          </section>
        </div>
      </>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
