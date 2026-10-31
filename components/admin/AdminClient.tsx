"use client";
// Admin: task setup, properties and people, with the same toolbar as the other screens.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Table, type Col } from "@/components/cc/parts";
import { ActiveChip, Field, FilterBar, SavedView, Stats, sameFilters } from "@/components/ui/Filters";

export type Tpl = { id: number; name: string; category: string; op_role: string; trigger: string; event_name: string | null; frequency: string; window_start: string; window_end: string;
  review_sla_h: number; audit_sla_h: number; attempts_allowed: number; criticality: string; audit_rate: number; active: number; props: number; reviewer: string | null; auditor: string | null };
export type Prop = { id: number; name: string; cluster: string; city: string; cbm: string | null; staff: number };
const ROLE_NAME: Record<string, string> = { admin: "Admin", reviewer: "Reviewers", auditor: "Auditors", cbm: "CBMs", ground: "Ground team" };
const when = (t: Tpl) => (t.trigger === "scheduled" ? t.frequency[0].toUpperCase() + t.frequency.slice(1) : t.trigger === "event" ? `On “${t.event_name}”` : "On demand");

export default function AdminClient({ templates, props, people, views, children }: { templates: Tpl[]; props: Prop[]; people: { access_role: string; n: number }[]; views: SavedView[]; children: React.ReactNode }) {
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
    { key: "name", label: "Task", value: (t) => t.name, render: (t) => <span><b>{t.name}</b>{t.criticality === "high" && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}{!t.active && <span className="pill" style={{ marginLeft: 6 }}>Paused</span>}</span>, sticky: true },
    { key: "cat", label: "Category", value: (t) => t.category },
    { key: "role", label: "Role", value: (t) => t.op_role },
    { key: "when", label: "When", value: (t) => when(t) },
    { key: "win", label: "Window", value: (t) => t.window_start, render: (t) => `${t.window_start}–${t.window_end}`, csv: (t) => `${t.window_start}-${t.window_end}` },
    { key: "sla", label: "Review / audit SLA", num: true, value: (t) => t.review_sla_h, render: (t) => `${t.review_sla_h}h / ${t.audit_sla_h}h` },
    { key: "att", label: "Attempts", num: true, value: (t) => t.attempts_allowed },
    { key: "audit", label: "Audit sample", num: true, value: (t) => t.audit_rate, render: (t) => `${Math.round(t.audit_rate * 100)}%` },
    { key: "rv", label: "Reviewer / auditor", value: (t) => t.reviewer, render: (t) => <span className="small"><div>{t.reviewer ?? "—"}</div><div className="muted">{t.auditor ?? "—"}</div></span>, csv: (t) => `${t.reviewer ?? ""} / ${t.auditor ?? ""}` },
    { key: "props", label: "Properties", num: true, value: (t) => t.props },
    { key: "edit", label: "", value: () => null, render: (t) => <Link href={`/admin/templates/${t.id}`}>Edit</Link>, csv: () => "" },
  ];
  const pcols: Col<Prop>[] = [
    { key: "name", label: "Property", value: (p) => p.name, sticky: true },
    { key: "cluster", label: "Cluster", value: (p) => p.cluster },
    { key: "city", label: "City", value: (p) => p.city },
    { key: "cbm", label: "CBM", value: (p) => p.cbm },
    { key: "staff", label: "Ground staff", num: true, value: (p) => p.staff },
  ];
  const total = people.reduce((a, p) => a + p.n, 0);
  return (
    <div className="page">
      <div className="row2"><h1>Admin</h1><span className="spacer" /><Link className="btn primary" href="/admin/templates/new">+ New task</Link></div>
      <FilterBar search={q} setSearch={setQ} searchLabel="Search tasks, properties, people" chips={chips} onClearAll={() => apply({})}
        saved={{ page: "admin", views, current, apply, notify: setToast, name: [cat, role, city].filter(Boolean).join(" · ") || "Admin view" }}
        panel={<>
          <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{roles.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Starts"><select value={trig} onChange={(e) => setTrig(e.target.value)}><option value="">Any way</option><option value="scheduled">On a schedule</option><option value="event">On an event</option><option value="on_demand">On demand</option></select></Field>
          <Field label="Show"><select value={state} onChange={(e) => setState(e.target.value)}><option value="">All task types</option><option value="active">Active only</option><option value="paused">Paused only</option><option value="critical">Critical only</option></select></Field>
          <Field label="Properties in"><select value={city} onChange={(e) => setCity(e.target.value)}><option value="">All cities</option>{cities.map((x) => <option key={x}>{x}</option>)}</select></Field>
        </>} />
      <Stats compact items={[
        { key: "tasks", label: "Task types", value: templates.length, sub: `${templates.filter((t) => t.active).length} active · ${templates.filter((t) => !t.active).length} paused` },
        { key: "crit", label: "Critical task types", value: templates.filter((t) => t.criticality === "high").length, active: state === "critical", onClick: () => setState(state === "critical" ? "" : "critical") },
        { key: "props", label: "Properties", value: props.length, sub: `${cities.length} cities` },
        { key: "people", label: "People", value: total, sub: people.map((p) => `${p.n} ${ROLE_NAME[p.access_role]?.toLowerCase() ?? p.access_role}`).join(" · ") },
      ]} />
      <section className="grid" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Task setup</h2>
        <Table name="Task setup" rows={tpl} cols={cols} rowKey={(t) => t.id} query={q} empty="No task types match these filters." />
      </section>
      {children}
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
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
