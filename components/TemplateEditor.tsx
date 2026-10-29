"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTemplate, TemplateInput } from "@/app/actions";

type T = TemplateInput;
type It = T["items"][number];
const DEFAULTS: Omit<T, "items" | "properties"> = {
  name: "", category: "Operations", op_role: "HK", trigger: "scheduled", event_name: null, frequency: "daily", weekday: 1,
  window_start: "10:00", window_end: "12:00", review_sla_h: 24, audit_sla_h: 48, attempts_allowed: 3, late_window_days: 1,
  criticality: "normal", audit_rate: 0.2, geofence: 1, reviewer_id: null, auditor_id: null, active: 1,
};
const CATEGORIES = ["Housekeeping", "Facilities", "Sales", "Resident experience", "Operations", "Safety", "Short stays", "Maintenance"];
const ROLES = ["HK", "Reception", "CC", "CBM", "Short stays"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TemplateEditor({ id, initial, initialItems, selected, geo, reviewers, auditors }: {
  id: number | null; initial: (Omit<T, "items" | "properties"> & { id: number }) | null;
  initialItems: { label: string; kind: string; photo_required: number; note_required: number }[];
  selected: number[]; geo: { id: number; city: string; cluster: string; property: string }[];
  reviewers: { id: number; name: string }[]; auditors: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [t, setT] = useState<Omit<T, "items" | "properties">>(() => {
    if (!initial) return { ...DEFAULTS, reviewer_id: reviewers[0]?.id ?? null, auditor_id: auditors[0]?.id ?? null };
    const { id: _id, ...rest } = initial;
    void _id;
    return rest;
  });
  const [items, setItems] = useState<It[]>(() => initialItems.length
    ? initialItems.map((i) => ({ label: i.label, kind: i.kind, photo_required: !!i.photo_required, note_required: !!i.note_required }))
    : [{ label: "", kind: "check", photo_required: true, note_required: false }]);
  const [props, setProps] = useState<number[]>(selected.length || id ? selected : geo.map((g) => g.id));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof T>(k: K, v: T[K]) => setT((x) => ({ ...x, [k]: v }));
  const setItem = (ix: number, patch: Partial<It>) => setItems((xs) => xs.map((x, i) => (i === ix ? { ...x, ...patch } : x)));
  const cities = [...new Set(geo.map((g) => g.city))];

  async function save() {
    const r = await saveTemplate(id, { ...t, items: items.filter((i) => i.label.trim()), properties: props });
    setMsg(r.ok ? { ok: true, text: r.msg ?? "Saved" } : { ok: false, text: r.error });
    router.refresh();
  }

  return (
    <div className="grid">
      <section className="card grid">
        <label className="f">Task name<input type="text" value={t.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Kitchen hygiene check" /></label>
        <div className="row2">
          <label className="f">Category<select value={t.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="f">Done by<select value={t.op_role} onChange={(e) => set("op_role", e.target.value)}>{ROLES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="f">Criticality<select value={t.criticality} onChange={(e) => set("criticality", e.target.value)}><option value="normal">Normal</option><option value="high">Critical</option></select></label>
          <label className="f">Status<select value={t.active} onChange={(e) => set("active", Number(e.target.value))}><option value={1}>Active</option><option value={0}>Paused</option></select></label>
        </div>
      </section>
      <section className="card grid">
        <h2 style={{ margin: 0 }}>When</h2>
        <div className="row2">
          <label className="f">Trigger<select value={t.trigger} onChange={(e) => set("trigger", e.target.value)}>
            <option value="scheduled">On a schedule</option><option value="event">When an event happens</option><option value="on_demand">On demand</option></select></label>
          {t.trigger === "scheduled" && <label className="f">Repeats<select value={t.frequency} onChange={(e) => set("frequency", e.target.value)}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly (1st)</option></select></label>}
          {t.trigger === "scheduled" && t.frequency === "weekly" && <label className="f">On<select value={t.weekday ?? 1} onChange={(e) => set("weekday", Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
          {t.trigger === "event" && <label className="f">Event<select value={t.event_name ?? ""} onChange={(e) => set("event_name", e.target.value)}>
            <option value="">Pick one</option><option>Tenant exited</option><option>Booking created</option><option>Complaint raised</option></select></label>}
          <label className="f">Window opens<input type="text" value={t.window_start} onChange={(e) => set("window_start", e.target.value)} style={{ width: 90 }} /></label>
          <label className="f">Window closes<input type="text" value={t.window_end} onChange={(e) => set("window_end", e.target.value)} style={{ width: 90 }} /></label>
          <label className="f">Late window<select value={t.late_window_days} onChange={(e) => set("late_window_days", Number(e.target.value))}>
            {[0, 1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d === 0 ? "Same day" : `${d} day${d > 1 ? "s" : ""}`}</option>)}</select></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>After the window closes the task is overdue. After the late window it becomes Missed.</p>
      </section>
      <section className="card grid">
        <h2 style={{ margin: 0 }}>Review and audit</h2>
        <div className="row2">
          <label className="f">Reviewer<select value={t.reviewer_id ?? ""} onChange={(e) => set("reviewer_id", Number(e.target.value))}>{reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="f">Review within<select value={t.review_sla_h} onChange={(e) => set("review_sla_h", Number(e.target.value))}>{[4, 8, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}</select></label>
          <label className="f">Attempts allowed<select value={t.attempts_allowed} onChange={(e) => set("attempts_allowed", Number(e.target.value))}>{[1, 2, 3, 4, 5].map((h) => <option key={h}>{h}</option>)}</select></label>
          <label className="f">Auditor<select value={t.auditor_id ?? ""} onChange={(e) => set("auditor_id", Number(e.target.value))}>{auditors.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="f">Audit within<select value={t.audit_sla_h} onChange={(e) => set("audit_sla_h", Number(e.target.value))}>{[4, 8, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}</select></label>
          <label className="f">Audit sample<select value={t.audit_rate} onChange={(e) => set("audit_rate", Number(e.target.value))}>{[0, 0.05, 0.1, 0.2, 0.3, 0.5, 1].map((r) => <option key={r} value={r}>{Math.round(r * 100)}% of passes</option>)}</select></label>
          <label className="f">Location check<select value={t.geofence} onChange={(e) => set("geofence", Number(e.target.value))}><option value={1}>Required (200 m)</option><option value={0}>Off</option></select></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>The auditor is never the person who reviewed or submitted the task. If they are, ZoTask picks another auditor.</p>
      </section>
      <section className="card grid">
        <h2 style={{ margin: 0 }}>Checklist</h2>
        {items.map((it, ix) => (
          <div key={ix} className="row2">
            <input type="text" value={it.label} onChange={(e) => setItem(ix, { label: e.target.value })} placeholder={`Item ${ix + 1}`} style={{ flex: "1 1 260px" }} />
            <select value={it.kind} onChange={(e) => setItem(ix, { kind: e.target.value })} aria-label="Answer type"><option value="check">Tick box</option><option value="number">Number</option><option value="text">Text</option></select>
            <label className="row2 small"><input type="checkbox" checked={it.photo_required} onChange={(e) => setItem(ix, { photo_required: e.target.checked })} /> Photo</label>
            <label className="row2 small"><input type="checkbox" checked={it.note_required} onChange={(e) => setItem(ix, { note_required: e.target.checked })} /> Note</label>
            <button type="button" className="link" onClick={() => setItems(items.filter((_, i) => i !== ix))} aria-label="Remove item">×</button>
          </div>
        ))}
        <div><button type="button" className="btn sm" onClick={() => setItems([...items, { label: "", kind: "check", photo_required: false, note_required: false }])}>+ Add item</button></div>
      </section>
      <section className="card grid">
        <div className="row2"><h2 style={{ margin: 0 }}>Properties</h2><span className="spacer" /><span className="small muted">{props.length} of {geo.length}</span>
          <button type="button" className="link small" onClick={() => setProps(geo.map((g) => g.id))}>All</button><button type="button" className="link small" onClick={() => setProps([])}>None</button></div>
        <div className="grid g3" style={{ gap: 4 }}>
          {cities.map((c) => (
            <div key={c}>
              <h3>{c}</h3>
              {geo.filter((g) => g.city === c).map((g) => (
                <label key={g.id} className="opt"><input type="checkbox" checked={props.includes(g.id)} onChange={(e) => setProps(e.target.checked ? [...props, g.id] : props.filter((x) => x !== g.id))} /> {g.property}<small>{g.cluster}</small></label>
              ))}
            </div>
          ))}
        </div>
      </section>
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}
      <div className="row2"><button className="btn primary" onClick={save}>Save task</button></div>
    </div>
  );
}
