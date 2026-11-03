"use client";
// Task setup in steps: Basics → Type & trigger → Checklist → Schedule & properties → Review & audit → Summary.
// The preview on the right updates as you type; the last step replays every step read-only, with links back to edit.
import { ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveTemplate, TemplateInput, TemplateItemInput } from "@/app/actions";
import { saveChecklistPreset } from "@/app/admin-actions";
import { SearchPick } from "@/components/ui/Filters";

type T = Omit<TemplateInput, "items" | "properties">;
type It = TemplateItemInput;
type Person = { id: number; name: string; access_role: string; op_role: string | null; props: string | null };
export type ChecklistPreset = { id: number; title: string; items: string };
export type SchedulePreset = { id: number; name: string; frequency: string; days: string; once_date: string | null; window_start: string; window_end: string };

export const EVENTS = ["Tenant onboarded", "Tenant exited", "Tenant exited by agent", "Booking confirmed", "Booking created", "Short stay tenant onboarded", "Short stay tenant exited"];
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ROLES = ["HK", "Reception", "CC", "CBM", "Short stays"];
const KINDS: [string, string][] = [["check", "Tick box"], ["number", "Number"], ["text", "Text"], ["count", "Staff count"]];
const TYPES = { scheduled: ["Scheduled", "Runs at set times"], event: ["Event-triggered", "Created when something happens"], on_demand: ["On demand", "Created by hand when needed"] } as const;
const STEPS = ["Basics", "Type & trigger", "Checklist", "Schedule & properties", "Review & audit", "Summary"];
const DEFAULTS: T = {
  name: "", category: "", op_role: "HK", trigger: "scheduled", event_name: null, frequency: "daily", weekday: 1,
  window_start: "09:00", window_end: "10:00", review_sla_h: 24, audit_sla_h: 24, attempts_allowed: 3, late_window_days: 2,
  criticality: "normal", audit_rate: 0.2, geofence: 0, reviewer_id: null, auditor_id: null, active: 1,
  description: "", events: "[]", days: "[]", once_date: null, start_stop: 1, geofence_m: 200, ideal_minutes: null, review_required: 1, assignees: "[]",
};
// Grow a one-line textarea to fit its text, so long checklist items are never cut off.
const fit = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; } };
const blank = (): It => ({ label: "", kind: "check", photo_allowed: true, photo_required: false, note_allowed: true, note_required: false, count_of: null });
const parse = <X,>(s: string | null | undefined, d: X): X => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const rule = (allowed: boolean, required: boolean) => (required ? "required" : allowed ? "optional" : "off");
const RULES: [string, string][] = [["off", "No"], ["optional", "Optional"], ["required", "Compulsory"]];
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** "Daily 09:00–10:00", "Weekly on Sat, Sun …", "When Booking created, Tenant exited". */
export function describeWhen(t: Pick<T, "trigger" | "frequency" | "days" | "once_date" | "window_start" | "window_end" | "events" | "event_name">) {
  if (t.trigger === "event") { const e = parse<string[]>(t.events, []); return `When ${(e.length ? e : [t.event_name ?? "an event"]).join(", ")}`; }
  if (t.trigger === "on_demand") return "On demand";
  const time = `${t.window_start}–${t.window_end}`, d = parse<number[]>(t.days, []);
  if (t.frequency === "once") return `Once on ${t.once_date ?? "?"}, ${time}`;
  if (t.frequency === "weekly") return `Weekly on ${d.length ? d.map((x) => DAYS[x]).join(", ") : "?"}, ${time}`;
  if (t.frequency === "monthly") return `Monthly on the ${d.length ? d.map(ord).join(", ") : "?"}, ${time}`;
  return `Daily ${time}`;
}

/** One checklist item: the question on top, then how it is answered, photo and note rules. Shared with the admin checklist library. */
export function ItemCard({ ix, it, last, onChange, onMove, onRemove }: {
  ix: number; it: It; last: boolean; onChange: (patch: Partial<It>) => void; onMove?: (d: number) => void; onRemove: () => void;
}) {
  const rules = [["Photo", it.photo_allowed, it.photo_required, (v: string) => onChange({ photo_allowed: v !== "off", photo_required: v === "required" })],
    ["Note", it.note_allowed, it.note_required, (v: string) => onChange({ note_allowed: v !== "off", note_required: v === "required" })]] as const;
  return (
    <div className="te-item">
      <div className="te-q">
        <span className="te-n">{ix + 1}</span>
        <textarea className="te-label" rows={1} ref={(el) => fit(el)} value={it.label} onChange={(e) => { fit(e.target); onChange({ label: e.target.value }); }} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} placeholder="Type the question or check, e.g. Lobby floor mopped" aria-label={`Item ${ix + 1}`} />
        <span className="te-act">
          {onMove && <>
            <button type="button" className="link" onClick={() => onMove(-1)} aria-label="Move up" title="Move up" disabled={ix === 0}>↑</button>
            <button type="button" className="link" onClick={() => onMove(1)} aria-label="Move down" title="Move down" disabled={last}>↓</button>
          </>}
          <button type="button" className="link te-del" onClick={onRemove} aria-label="Remove item" title="Remove">×</button>
        </span>
      </div>
      <div className="te-opts">
        <label className="te-opt">Answer
          <select value={it.kind === "count" ? `count:${it.count_of ?? "HK"}` : it.kind}
            onChange={(e) => { const v = e.target.value; onChange(v.startsWith("count:") ? { kind: "count", count_of: v.slice(6) } : { kind: v, count_of: null }); }}>
            {KINDS.filter(([k]) => k !== "count").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="count:HK">Number of HKs</option><option value="count:SHK">Number of SHKs</option>
          </select></label>
        {rules.map(([name, allowed, required, change]) => (
          <div key={name} className="te-opt">{name}
            <div className="seg te-rules" role="group" aria-label={`${name} for item ${ix + 1}`}>
              {RULES.map(([k, l]) => <button key={k} type="button" data-k={k} aria-pressed={rule(allowed, required) === k} onClick={() => change(k)}>{l}</button>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TemplateEditor({ id, initial, initialItems, selected, geo, reviewers, auditors, people, categories, checklists, schedules }: {
  id: number | null; initial: (T & { id: number }) | null; initialItems: (Omit<It, "photo_allowed" | "photo_required" | "note_allowed" | "note_required"> & { photo_allowed: number; photo_required: number; note_allowed: number; note_required: number })[];
  selected: number[]; geo: { id: number; city: string; cluster: string; property: string }[];
  reviewers: { id: number; name: string }[]; auditors: { id: number; name: string }[]; people: Person[];
  categories: string[]; checklists: ChecklistPreset[]; schedules: SchedulePreset[];
}) {
  const router = useRouter();
  const [t, setT] = useState<T>(() => {
    if (!initial) return { ...DEFAULTS, category: categories[0] ?? "" };
    const { id: _id, ...rest } = initial;
    void _id;
    return { ...DEFAULTS, ...rest, description: rest.description ?? "" };
  });
  const [items, setItems] = useState<It[]>(() => initialItems.length
    ? initialItems.map((i) => ({ label: i.label, kind: i.kind, photo_allowed: !!i.photo_allowed, photo_required: !!i.photo_required, note_allowed: !!i.note_allowed, note_required: !!i.note_required, count_of: i.count_of }))
    : [blank()]);
  const [props, setProps] = useState<number[]>(selected.length || id ? selected : geo.map((g) => g.id));
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof T>(k: K, v: T[K]) => setT((x) => ({ ...x, [k]: v }));
  const setItem = (ix: number, patch: Partial<It>) => setItems((xs) => xs.map((x, i) => (i === ix ? { ...x, ...patch } : x)));
  const moveItem = (ix: number, d: number) => setItems((xs) => { const ys = [...xs]; const j = ix + d; if (j < 0 || j >= ys.length) return xs; [ys[ix], ys[j]] = [ys[j], ys[ix]]; return ys; });
  const cities = [...new Set(geo.map((g) => g.city))].sort();
  // Property picker: narrow by search, city, cluster or "selected only", then tick one by one or in bulk.
  const [pq, setPq] = useState(""), [pCity, setPCity] = useState(""), [pCluster, setPCluster] = useState(""), [pSel, setPSel] = useState(false);
  const picked = useMemo(() => new Set(props), [props]);
  const clusters = [...new Set(geo.filter((g) => !pCity || g.city === pCity).map((g) => g.cluster))].sort();
  const shown = geo.filter((g) => (!pCity || g.city === pCity) && (!pCluster || g.cluster === pCluster) && (!pSel || picked.has(g.id))
    && (!pq.trim() || `${g.property} ${g.cluster} ${g.city}`.toLowerCase().includes(pq.trim().toLowerCase())));
  const shownIds = shown.map((g) => g.id), shownAll = shownIds.length > 0 && shownIds.every((x) => picked.has(x));
  const addProps = (ids: number[]) => setProps([...new Set([...props, ...ids])]);
  const dropProps = (ids: number[]) => { const d = new Set(ids); setProps(props.filter((x) => !d.has(x))); };
  const cityCount = (c: string) => { const ids = geo.filter((g) => g.city === c).map((g) => g.id); return [ids.filter((x) => picked.has(x)).length, ids.length]; };
  const events = parse<string[]>(t.events, []), days = parse<number[]>(t.days, []), named = parse<number[]>(t.assignees, []);
  const cats = t.category && !categories.includes(t.category) ? [t.category, ...categories] : categories;
  const assignable = useMemo(() => people.filter((p) => p.access_role === "ground" || p.access_role === "cbm"), [people]);
  const timed = t.trigger !== "scheduled";
  const hours = Math.max(1, Math.round((Number(t.window_end.slice(0, 2)) * 60 + Number(t.window_end.slice(3)) - Number(t.window_start.slice(0, 2)) * 60 - Number(t.window_start.slice(3))) / 60));

  const [pending, setPending] = useState<ChecklistPreset | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);
  function loadChecklist(pid: string, force = false) {
    const p = checklists.find((c) => String(c.id) === pid);
    if (!p) return;
    if (!force && items.some((i) => i.label.trim())) return setPending(p);
    setPending(null);
    setItems(parse<Partial<It>[]>(p.items, []).map((i) => ({ ...blank(), ...i, photo_allowed: !!i.photo_allowed, photo_required: !!i.photo_required, note_allowed: !!i.note_allowed, note_required: !!i.note_required })));
  }
  function loadSchedule(sid: string) {
    const s = schedules.find((x) => String(x.id) === sid);
    if (s) setT((x) => ({ ...x, frequency: s.frequency, days: s.days, once_date: s.once_date, window_start: s.window_start, window_end: s.window_end }));
  }
  // An existing task saves at every step and moves on; a new one is only created from the last step.
  async function save(next = false) {
    setBusy(true);
    const r = await saveTemplate(id, { ...t, event_name: events[0] ?? null, weekday: days[0] ?? null, items: items.filter((i) => i.label.trim()), properties: props });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: r.msg ?? "Saved" } : { ok: false, text: r.error });
    if (r.ok && next) setStep((s) => Math.min(s + 1, STEPS.length - 1));
    router.refresh();
  }
  const last = step === STEPS.length - 1;
  async function savePreset(title: string) {
    const r = await saveChecklistPreset(null, title, items);
    setMsg(r.ok ? { ok: true, text: r.msg ?? "Saved" } : { ok: false, text: r.error });
    if (r.ok) { setPresetName(null); router.refresh(); }
  }
  const toggle = (k: "events" | "days" | "assignees", v: string | number) => {
    const cur = parse<(string | number)[]>(t[k], []);
    set(k, JSON.stringify(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : 0))));
  };

  const filled = items.filter((i) => i.label.trim());
  const summary = (
    <aside className="card te-sum" aria-label="Summary">
      <div className="small muted">Preview</div>
      <h3>{t.name || "Untitled task"}{t.criticality === "high" && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}{!t.active && <span className="pill" style={{ marginLeft: 6 }}>Paused</span>}</h3>
      {t.description && <p className="small" style={{ margin: 0 }}>{t.description}</p>}
      <dl>
        <dt>Category</dt><dd>{t.category || "Uncategorised"}</dd>
        <dt>Done by</dt><dd>{named.length ? named.map((n) => people.find((p) => p.id === n)?.name).filter(Boolean).join(", ") : `${t.op_role} at each property`}</dd>
        <dt>When</dt><dd>{describeWhen(t)}{timed && ` · ${hours}h to finish`}</dd>
        <dt>Late</dt><dd>{t.late_window_days === 0 ? "Same day, then Missed" : `Up to ${t.late_window_days} day${t.late_window_days > 1 ? "s" : ""}, then Missed`}</dd>
        <dt>On site</dt><dd>{[t.start_stop ? "Start/Stop button" : "", t.geofence ? `within ${t.geofence_m} m` : "no location check", t.ideal_minutes ? `ideal ${t.ideal_minutes} min` : ""].filter(Boolean).join(" · ")}</dd>
        <dt>Checklist</dt><dd>{filled.length} items · {items.filter((i) => i.photo_required).length} need a photo</dd>
        <dt>Properties</dt><dd>{props.length} of {geo.length}</dd>
        <dt>Review</dt><dd>{t.review_required ? `${reviewers.find((r) => r.id === t.reviewer_id)?.name ?? "Cluster reviewer"} within ${t.review_sla_h}h · ${t.attempts_allowed} attempt${t.attempts_allowed > 1 ? "s" : ""}` : "None, done on submit"}</dd>
        {!!t.review_required && <><dt>Audit</dt><dd>{auditors.find((r) => r.id === t.auditor_id)?.name ?? "Any auditor"} · {Math.round(t.audit_rate * 100)}% within {t.audit_sla_h}h</dd></>}
      </dl>
    </aside>
  );

  // The last step: every earlier step again, read-only, drawn with the same controls.
  const gaps = [
    !t.name.trim() && "Give the task a name",
    !filled.length && "Add at least one checklist item",
    !props.length && "Pick at least one property",
    t.trigger === "event" && !events.length && "Pick the events that create this task",
    t.trigger === "scheduled" && (t.frequency === "weekly" || t.frequency === "monthly") && !days.length && `Pick the ${t.frequency === "weekly" ? "days" : "dates"} it repeats on`,
    t.trigger === "scheduled" && t.frequency === "once" && !t.once_date && "Pick the date it runs on",
  ].filter(Boolean) as string[];
  const head = (i: number) => <div className="te-rvh"><span className="te-rvn">{i + 1}</span><h3>{STEPS[i]}</h3><span className="spacer" /><button type="button" className="link small" onClick={() => setStep(i)}>Edit</button></div>;
  const fv = (label: string, value: ReactNode) => <div className="te-fv"><span>{label}</span><div>{value}</div></div>;
  const on = (checked: boolean, label: ReactNode) => <label className="switch"><input type="checkbox" checked={checked} readOnly tabIndex={-1} />{label}</label>;
  const rulePill = (allowed: boolean, required: boolean) => required ? <span className="pill a">Compulsory</span> : allowed ? <span className="pill b">Optional</span> : <span className="pill">No</span>;
  const review = (
    <div className="te-rv">
      <div className={gaps.length ? "te-gaps warn" : "te-gaps ready"}>
        {gaps.length ? <><b>Before you save</b><ul>{gaps.map((g) => <li key={g}>{g}</li>)}</ul></> : <b>Everything is filled in. Ready to {id ? "save" : "create"}.</b>}
      </div>

      <section className="card grid">
        {head(0)}
        <div className="te-rvtitle"><b>{t.name || <span className="muted">Untitled task</span>}</b>
          <span className={t.criticality === "high" ? "pill r" : "pill"}>{t.criticality === "high" ? "Critical" : "Normal"}</span>
          <span className={t.active ? "pill g" : "pill"}>{t.active ? "Active" : "Paused"}</span></div>
        {t.description && <p className="small" style={{ margin: 0 }}>{t.description}</p>}
        <div className="te-fvs">
          {fv("Category", t.category || "Uncategorised")}
          {fv("Done by role", t.op_role)}
          {fv("Specific people", named.length ? <div className="chips">{named.map((n) => <span key={n} className="chipn">{people.find((p) => p.id === n)?.name}</span>)}</div> : <span className="muted">Whoever has the role at each property</span>)}
        </div>
      </section>

      <section className="card grid">
        {head(1)}
        {(() => { const [l, sub] = TYPES[t.trigger as keyof typeof TYPES] ?? TYPES.scheduled; return <div className="te-type"><b>{l}</b><small>{sub}</small></div>; })()}
        {t.trigger === "event" && fv("Events that create this task", events.length ? <div className="chips">{events.map((e) => <span key={e} className="chipn">{e}</span>)}</div> : <span className="muted">None picked</span>)}
        {timed && <div className="te-fvs">{fv("Time to finish", hours === 23 ? "Same day" : `${hours} hour${hours > 1 ? "s" : ""}`)}</div>}
        <div className="te-ons">
          {on(!!t.start_stop, "Start and Stop button")}
          {on(!!t.geofence, <>Location check{!!t.geofence && <span className="pill b">within {t.geofence_m} m</span>}</>)}
          {on(!!t.ideal_minutes, <>Ideal completion time{!!t.ideal_minutes && <span className="pill b">{t.ideal_minutes} min</span>}</>)}
        </div>
      </section>

      <section className="card grid">
        {head(2)}
        {filled.length ? <div className="te-rvitems">
          <div className="te-rvrow te-rvhead"><span>#</span><span>Item</span><span>Answer</span><span>Photo</span><span>Note</span></div>
          {filled.map((i, ix) => (
            <div key={ix} className="te-rvrow">
              <span className="te-n">{ix + 1}</span>
              <span>{i.label}</span>
              <span><span className="chipn">{i.kind === "count" ? `Number of ${i.count_of ?? "HK"}s` : KINDS.find(([k]) => k === i.kind)?.[1]}</span></span>
              <span>{rulePill(i.photo_allowed, i.photo_required)}</span>
              <span>{rulePill(i.note_allowed, i.note_required)}</span>
            </div>
          ))}
        </div> : <p className="small muted" style={{ margin: 0 }}>No checklist items yet.</p>}
      </section>

      <section className="card grid">
        {head(3)}
        {t.trigger === "scheduled" ? <>
          <div className="te-fvs">
            {fv("Start time", t.window_start)}
            {fv("End time", t.window_end)}
            {t.frequency === "once" && fv("Date", t.once_date ?? <span className="muted">Not picked</span>)}
          </div>
          <div className="seg te-ro" role="group" aria-label="Repeats">
            {([["once", "Once"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]] as const).map(([k, l]) => <button key={k} type="button" tabIndex={-1} aria-pressed={t.frequency === k}>{l}</button>)}
          </div>
          {t.frequency === "weekly" && <div className="te-days te-ro">{DAYS.map((d, i) => <button key={d} type="button" tabIndex={-1} aria-pressed={days.includes(i)}>{d}</button>)}</div>}
          {t.frequency === "monthly" && <div className="te-days te-month te-ro">{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <button key={d} type="button" tabIndex={-1} aria-pressed={days.includes(d)}>{d}</button>)}</div>}
        </> : <p className="small muted" style={{ margin: 0 }}>{t.trigger === "event" ? "Event-triggered" : "On-demand"} tasks have no schedule.</p>}
        <div className="row2"><h3 className="te-h" style={{ margin: 0 }}>Properties</h3><span className="spacer" /><span className={props.length ? "pill b" : "pill r"}>{props.length === geo.length ? "All" : props.length} of {geo.length}</span></div>
        {props.length > 0 && <div className="te-rvprops">
          {cities.map((c) => {
            const [n, of] = cityCount(c), ps = geo.filter((g) => g.city === c && picked.has(g.id));
            return n ? <div key={c} className="te-rvcity"><b>{c}</b><span className={n === of ? "pill g" : "pill b"}>{n === of ? `All ${of}` : `${n} of ${of}`}</span>
              {n < of && <span className="small muted">{ps.slice(0, 4).map((g) => g.property).join(", ")}{n > 4 && ` +${n - 4} more`}</span>}</div> : null;
          })}
        </div>}
      </section>

      <section className="card grid">
        {head(4)}
        {on(!!t.review_required, "Needs review before it counts as done")}
        {t.review_required ? <div className="te-fvs">
          {fv("Reviewer", reviewers.find((r) => r.id === t.reviewer_id)?.name ?? "Cluster's reviewer")}
          {fv("Review within", `${t.review_sla_h} hours`)}
          {fv("Attempts allowed", t.attempts_allowed === 1 ? "1 (no fixes)" : t.attempts_allowed)}
          {fv("Auditor", auditors.find((r) => r.id === t.auditor_id)?.name ?? "Any auditor")}
          {fv("Audit within", `${t.audit_sla_h} hours`)}
          {fv("Audit sample", `${Math.round(t.audit_rate * 100)}% of passes`)}
        </div> : <p className="small muted" style={{ margin: 0 }}>Counts as done as soon as it is submitted.</p>}
        <div className="te-fvs">{fv("Late submission allowed", t.late_window_days === 0 ? "Same day" : `${t.late_window_days} day${t.late_window_days > 1 ? "s" : ""}`)}</div>
      </section>
    </div>
  );

  return (
    <div className="te">
      <nav className="te-steps" aria-label="Steps">
        {STEPS.map((s, i) => <button key={s} type="button" className={i === step ? "on" : ""} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}><span>{i + 1}</span>{s}</button>)}
      </nav>
      <div className={step === 5 ? "te-body te-full" : "te-body"}>
        <div className="grid">
          {step === 0 && <section className="card grid">
            <label className="f">Task name<input type="text" value={t.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Lobby deep cleaning" /></label>
            <label className="f">Description<textarea value={t.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="What should be done, and what good looks like" rows={3} /></label>
            <div className="te-row">
              <label className="f">Category<select value={t.category} onChange={(e) => set("category", e.target.value)}><option value="">Uncategorised</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="f">Done by role<select value={t.op_role} onChange={(e) => set("op_role", e.target.value)}>{ROLES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="f">Criticality<select value={t.criticality} onChange={(e) => set("criticality", e.target.value)}><option value="normal">Normal</option><option value="high">Critical</option></select></label>
              <label className="f">Status<select value={t.active} onChange={(e) => set("active", Number(e.target.value))}><option value={1}>Active</option><option value={0}>Paused</option></select></label>
            </div>
            <div className="f">Assign specific people (optional)
              <SearchPick multi value="" onChange={(v) => toggle("assignees", Number(v))} placeholder="Type a name"
                options={assignable.filter((p) => !named.includes(p.id)).map((p) => ({ v: String(p.id), label: p.name, sub: [p.op_role ?? (p.access_role === "cbm" ? "CBM" : ""), p.props].filter(Boolean).join(" · ") }))} />
              {named.length > 0 && <div className="chips">{named.map((n) => <span key={n} className="chip">{people.find((p) => p.id === n)?.name}<button type="button" aria-label="Remove" onClick={() => toggle("assignees", n)}>×</button></span>)}</div>}
              <span className="small muted" style={{ fontWeight: 400 }}>Empty means whoever has the role at each property.</span>
            </div>
          </section>}

          {step === 1 && <section className="card grid">
            <div className="seg te-seg" role="group" aria-label="Task type">
              {(Object.entries(TYPES) as [keyof typeof TYPES, readonly [string, string]][]).map(([k, [l, sub]]) => (
                <button key={k} type="button" aria-pressed={t.trigger === k} onClick={() => set("trigger", k)}><b>{l}</b><small>{sub}</small></button>
              ))}
            </div>
            {t.trigger === "event" && <div className="f">Events that create this task
              <div className="te-checks">{EVENTS.map((e) => <label key={e} className="opt"><input type="checkbox" checked={events.includes(e)} onChange={() => toggle("events", e)} />{e}</label>)}</div>
            </div>}
            {timed && <label className="f">Time to finish<select value={hours} onChange={(e) => { const h = Number(e.target.value); set("window_start", "00:00"); set("window_end", `${String(h).padStart(2, "0")}:00`); }}>
              {[1, 2, 4, 8, 12, 23].map((h) => <option key={h} value={h}>{h === 23 ? "Same day" : `${h} hour${h > 1 ? "s" : ""}`}</option>)}</select></label>}
            <h3 className="te-h">On site</h3>
            <label className="switch"><input type="checkbox" checked={!!t.start_stop} onChange={(e) => set("start_stop", e.target.checked ? 1 : 0)} />Start and Stop button, to track time spent</label>
            <div className="te-row">
              <label className="switch"><input type="checkbox" checked={!!t.geofence} onChange={(e) => set("geofence", e.target.checked ? 1 : 0)} />Check they are at the property</label>
              {!!t.geofence && <label className="f">Maximum distance (m)<input type="number" min={10} max={1000} step={10} value={t.geofence_m} onChange={(e) => set("geofence_m", Number(e.target.value))} style={{ width: 120 }} /></label>}
            </div>
            <label className="f">Ideal completion time (minutes, optional)<input type="number" min={1} value={t.ideal_minutes ?? ""} onChange={(e) => set("ideal_minutes", e.target.value ? Number(e.target.value) : null)} style={{ width: 120 }} /></label>
          </section>}

          {step === 2 && <section className="card grid">
            <div className="te-row">
              {checklists.length > 0 && <label className="f">Start from a predefined checklist<select value="" onChange={(e) => loadChecklist(e.target.value)}><option value="">Pick one</option>{checklists.map((c) => <option key={c.id} value={c.id}>{c.title} ({parse<unknown[]>(c.items, []).length})</option>)}</select></label>}
              <span className="spacer" />
              {presetName === null && <button type="button" className="btn sm" onClick={() => setPresetName(t.name)}>Save as predefined checklist</button>}
            </div>
            {presetName !== null && <form className="row2 te-ask" onSubmit={(e) => { e.preventDefault(); void savePreset(presetName); }}>
              <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Checklist name" aria-label="Checklist name" style={{ flex: "1 1 220px" }} autoFocus />
              <button className="btn primary sm">Save checklist</button><button type="button" className="btn sm" onClick={() => setPresetName(null)}>Cancel</button>
            </form>}
            {pending && <div className="row2 te-ask"><span className="small">Replace the {items.filter((i) => i.label.trim()).length} items below with <b>{pending.title}</b>?</span><span className="spacer" />
              <button type="button" className="btn primary sm" onClick={() => loadChecklist(String(pending.id), true)}>Replace</button><button type="button" className="btn sm" onClick={() => setPending(null)}>Cancel</button></div>}
            <div className="te-items">
              {items.map((it, ix) => (
                <ItemCard key={ix} ix={ix} it={it} last={ix === items.length - 1} onChange={(patch) => setItem(ix, patch)}
                  onMove={(d) => moveItem(ix, d)} onRemove={() => setItems(items.filter((_, i) => i !== ix))} />
              ))}
            </div>
            <div><button type="button" className="btn sm" onClick={() => setItems([...items, blank()])}>+ Add item</button></div>
            <p className="small muted" style={{ margin: 0 }}>Staff counts are always compulsory and are checked at review against the property&apos;s ideal HK or SHK count.</p>
          </section>}

          {step === 3 && <>
            {t.trigger === "scheduled" ? <section className="card grid">
              <div className="te-row">
                {schedules.length > 0 && <label className="f">Use a predefined schedule<select value="" onChange={(e) => loadSchedule(e.target.value)}><option value="">Pick one</option>{schedules.map((s) => <option key={s.id} value={s.id}>{s.name} · {describeWhen({ ...s, trigger: "scheduled", events: "[]", event_name: null })}</option>)}</select></label>}
              </div>
              <div className="te-row">
                <label className="f">Start time<input type="time" value={t.window_start} onChange={(e) => set("window_start", e.target.value)} /></label>
                <label className="f">End time<input type="time" value={t.window_end} onChange={(e) => set("window_end", e.target.value)} /></label>
                <label className="f">Repeats<select value={t.frequency} onChange={(e) => { set("frequency", e.target.value); set("days", JSON.stringify(e.target.value === "weekly" ? [1] : e.target.value === "monthly" ? [1] : [])); }}>
                  <option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                {t.frequency === "once" && <label className="f">Date<input type="date" value={t.once_date ?? ""} onChange={(e) => set("once_date", e.target.value)} /></label>}
              </div>
              {t.frequency === "weekly" && <div className="f">On these days<div className="te-days">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => toggle("days", i)}>{d}</button>)}</div></div>}
              {t.frequency === "monthly" && <div className="f">On these dates<div className="te-days te-month">{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle("days", d)}>{d}</button>)}</div>
                <span className="small muted" style={{ fontWeight: 400 }}>Months without that date (like the 31st) are skipped.</span></div>}
            </section> : <p className="card small muted" style={{ margin: 0 }}>{t.trigger === "event" ? "Event-triggered" : "On-demand"} tasks have no schedule. They open when created and run for the time to finish set in step 2.</p>}
            <section className="card grid">
              <div className="row2"><h3 className="te-h" style={{ margin: 0 }}>Properties</h3><span className="spacer" /><span className={props.length ? "pill b" : "pill r"}>{props.length} of {geo.length} selected</span>
                <button type="button" className="link small" onClick={() => setProps(geo.map((g) => g.id))}>All</button><button type="button" className="link small" onClick={() => setProps([])}>None</button></div>
              <div className="te-cities" role="group" aria-label="Cities">
                {cities.map((c) => { const [n, of] = cityCount(c); return (
                  <button key={c} type="button" aria-pressed={pCity === c} className={n === of ? "full" : n ? "part" : ""} onClick={() => { setPCity(pCity === c ? "" : c); setPCluster(""); }}>{c}<small>{n}/{of}</small></button>
                ); })}
              </div>
              <div className="te-pfilt">
                <input type="search" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search property, cluster or city" aria-label="Search properties" />
                <select value={pCity} onChange={(e) => { setPCity(e.target.value); setPCluster(""); }} aria-label="City"><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</select>
                <select value={pCluster} onChange={(e) => setPCluster(e.target.value)} aria-label="Cluster"><option value="">All clusters</option>{clusters.map((c) => <option key={c}>{c}</option>)}</select>
                <label className="switch"><input type="checkbox" checked={pSel} onChange={(e) => setPSel(e.target.checked)} />Selected only</label>
              </div>
              <div className="te-pbar">
                <label className="opt"><input type="checkbox" checked={shownAll} disabled={!shown.length} onChange={() => (shownAll ? dropProps(shownIds) : addProps(shownIds))} />
                  <b>{shownAll ? "Clear" : "Select"} all {shown.length} shown</b></label>
                <span className="spacer" />
                {(pq || pCity || pCluster || pSel) && <button type="button" className="link small" onClick={() => { setPq(""); setPCity(""); setPCluster(""); setPSel(false); }}>Reset filters</button>}
              </div>
              <div className="te-plist">
                {!shown.length && <p className="small muted" style={{ margin: 8 }}>No properties match.</p>}
                {[...new Set(shown.map((g) => `${g.city} · ${g.cluster}`))].sort().map((k) => {
                  const grp = shown.filter((g) => `${g.city} · ${g.cluster}` === k), ids = grp.map((g) => g.id), all = ids.every((x) => picked.has(x));
                  return (
                    <div key={k} className="te-pgrp">
                      <label className="te-pgh"><input type="checkbox" checked={all} onChange={() => (all ? dropProps(ids) : addProps(ids))} />{k}<small>{ids.filter((x) => picked.has(x)).length}/{ids.length}</small></label>
                      <div className="te-popts">
                        {grp.map((g) => <label key={g.id} className="opt"><input type="checkbox" checked={picked.has(g.id)} onChange={(e) => (e.target.checked ? addProps([g.id]) : dropProps([g.id]))} />{g.property}</label>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>}

          {step === 4 && <section className="card grid">
            <label className="switch"><input type="checkbox" checked={!!t.review_required} onChange={(e) => set("review_required", e.target.checked ? 1 : 0)} />Needs review before it counts as done</label>
            {t.review_required ? <>
              <div className="te-row">
                <label className="f">Reviewer<select value={t.reviewer_id ?? ""} onChange={(e) => set("reviewer_id", e.target.value ? Number(e.target.value) : null)}><option value="">Cluster&apos;s reviewer</option>{reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <label className="f">Review within<select value={t.review_sla_h} onChange={(e) => set("review_sla_h", Number(e.target.value))}>{[4, 8, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}</select></label>
                <label className="f">Attempts allowed<select value={t.attempts_allowed} onChange={(e) => set("attempts_allowed", Number(e.target.value))}>{[1, 2, 3, 4, 5].map((h) => <option key={h} value={h}>{h === 1 ? "1 (no fixes)" : h}</option>)}</select></label>
              </div>
              <div className="te-row">
                <label className="f">Auditor<select value={t.auditor_id ?? ""} onChange={(e) => set("auditor_id", e.target.value ? Number(e.target.value) : null)}><option value="">Any auditor</option>{auditors.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <label className="f">Audit within<select value={t.audit_sla_h} onChange={(e) => set("audit_sla_h", Number(e.target.value))}>{[4, 8, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}</select></label>
                <label className="f">Audit sample<select value={t.audit_rate} onChange={(e) => set("audit_rate", Number(e.target.value))}>{[0, 0.05, 0.1, 0.2, 0.3, 0.5, 1].map((r) => <option key={r} value={r}>{Math.round(r * 100)}% of passes</option>)}</select></label>
              </div>
              <p className="small muted" style={{ margin: 0 }}>Only people with the Reviewer or Auditor role are listed. The auditor is never the person who reviewed or submitted the task.</p>
            </> : <p className="small muted" style={{ margin: 0 }}>Without review, a task counts as done as soon as it is submitted.</p>}
            <label className="f">Late submission allowed<select value={t.late_window_days} onChange={(e) => set("late_window_days", Number(e.target.value))}>
              {[0, 1, 2, 3, 7].map((d) => <option key={d} value={d}>{d === 0 ? "Same day" : `${d} day${d > 1 ? "s" : ""}`}</option>)}</select></label>
            <p className="small muted" style={{ margin: 0 }}>After that the task becomes Missed. An admin can reopen it.</p>
          </section>}

          {step === 5 && review}

          {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}
          <div className="row2">
            {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>‹ Back</button>}
            <span className="spacer" />
            {last ? <button type="button" className="btn primary" onClick={() => save()} disabled={busy}>{busy ? "Saving…" : id ? "Save changes" : "Create task"}</button>
              : id ? <button type="button" className="btn primary" onClick={() => save(true)} disabled={busy}>{busy ? "Saving…" : "Save & next ›"}</button>
              : <button type="button" className="btn primary" onClick={() => { setMsg(null); setStep(step + 1); }}>Next ›</button>}
          </div>
        </div>
        {step < 5 && <div className="te-side">{summary}</div>}
      </div>
    </div>
  );
}
