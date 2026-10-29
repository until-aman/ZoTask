"use client";
// Escalation tracker: the central team raises issues with other teams, follows them to closure, and leadership sees the totals.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Esc, EscData } from "@/lib/escalations";
import { raiseEscalation, updateEscalation } from "@/app/actions";
import { CopyModal, InfoTip, Sec, Table, type Col } from "@/components/cc/parts";
import Photo from "@/components/Photo";

const STATUS: Record<string, string> = { open: "Yet to start", wip: "In progress", done: "Closed", dropped: "Dropped" };
const PILL: Record<string, string> = { open: "a", wip: "b", done: "g", dropped: "" };
const PRIO: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
const PRIO_DAYS: Record<string, number> = { high: 1, medium: 3, low: 7 };
const DAY = 864e5;
const isOpen = (s: string) => s === "open" || s === "wip";
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const dayIso = (iso: string) => new Date(iso + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (ms: number, now: number) => { const h = (now - ms) / 36e5; return h < 1 ? "just now" : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`; };
const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n, 12); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const median = (l: number[]) => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmtDays = (v: number | null) => (v === null ? "—" : v < 1 ? `${Math.max(1, Math.round(v * 24))}h` : `${Math.round(v * 10) / 10}d`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const PERIODS: [string, string, number][] = [["7", "7 days", 7], ["30", "30 days", 30], ["90", "90 days", 90], ["all", "All time", 100000]];

type Quick = "open" | "overdue" | "soon" | "closed" | "all";
type Focus = { label: string; ids: number[] } | null;

export default function Escalations({ data: d }: { data: EscData }) {
  const router = useRouter();
  const [tab, setTab] = useState<"tracker" | "summary">("tracker");
  const [quick, setQuick] = useState<Quick>("open");
  const [dept, setDept] = useState("");
  const [city, setCity] = useState("");
  const [cluster, setCluster] = useState("");
  const [prop, setProp] = useState("");
  const [owner, setOwner] = useState("");
  const [by, setBy] = useState("");
  const [period, setPeriod] = useState("30");
  const [focus, setFocus] = useState<Focus>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [raising, setRaising] = useState(d.openNew && d.canRaise);
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".tip-pop")) { setOpen(null); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  // Filters other than status apply to both tabs.
  const scoped = useMemo(() => d.rows.filter((r) => (!dept || r.department === dept) && (!owner || r.owner === owner) && (!by || r.raisedBy === by)
    && (!city || r.props.some((p) => p.city === city)) && (!cluster || r.props.some((p) => p.cluster === cluster)) && (!prop || r.props.some((p) => String(p.id) === prop))), [d.rows, dept, owner, by, city, cluster, prop]);
  const soon = addDays(d.today, 2);
  const isQuick = (r: Esc, q: Quick) => q === "all" ? true : q === "open" ? isOpen(r.status) : q === "overdue" ? r.overdue : q === "soon" ? isOpen(r.status) && !r.overdue && !!r.due && r.due <= soon : !isOpen(r.status);
  const counts = { open: 0, overdue: 0, soon: 0, closed: 0, all: 0 } as Record<Quick, number>;
  for (const r of scoped) for (const q of Object.keys(counts) as Quick[]) if (isQuick(r, q)) counts[q]++;
  const list = focus ? d.rows.filter((r) => focus.ids.includes(r.id)) : scoped.filter((r) => isQuick(r, quick));
  const show = (label: string, rows: Esc[]) => { setFocus({ label, ids: rows.map((r) => r.id) }); setTab("tracker"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const cities = [...new Set(d.geo.map((g) => g.city))];
  const clusters = [...new Set(d.geo.filter((g) => !city || g.city === city).map((g) => g.cluster))];
  const props = d.geo.filter((g) => (!city || g.city === city) && (!cluster || g.cluster === cluster));
  const owners = [...new Set(d.rows.map((r) => r.owner))].sort();
  const raisers = [...new Set(d.rows.map((r) => r.raisedBy))].sort();
  const anyFilter = dept || city || cluster || prop || owner || by;
  const cur = open !== null ? d.rows.find((r) => r.id === open) ?? null : null;
  const done = (msg: string, id?: number) => { setToast(msg); router.refresh(); if (id) setOpen(id); };

  const cols: Col<Esc>[] = [
    { key: "ref", label: "Ref", value: (r) => r.id, render: (r) => <button type="button" className="link" style={{ whiteSpace: "nowrap" }} onClick={() => setOpen(r.id)}>{r.ref}</button>, csv: (r) => r.ref, sticky: true },
    { key: "created", label: "Raised on", value: (r) => r.created, render: (r) => day(r.created), csv: (r) => new Date(r.created).toISOString().slice(0, 10) },
    { key: "dept", label: "Department", value: (r) => r.department },
    { key: "prop", label: "Property", value: (r) => r.props.map((p) => p.name).join(", "), render: (r) => <span className="ell" style={{ maxWidth: 180, display: "inline-block" }} title={r.props.map((p) => p.name).join(", ")}>{r.props.map((p) => p.name.replace(/^Zolo /, "")).join(", ")}</span> },
    { key: "cluster", label: "Cluster", value: (r) => [...new Set(r.props.map((p) => p.cluster))].join(", "), hidden: true },
    { key: "title", label: "Issue", value: (r) => r.title, render: (r) => <button type="button" className="esc-title" onClick={() => setOpen(r.id)} title={r.detail}>{r.priority === "high" && <span className="pill r">High</span>} {r.title}</button> },
    { key: "by", label: "Raised by", value: (r) => r.raisedBy },
    { key: "owner", label: "Raised to", value: (r) => r.owner, render: (r) => <span>{r.owner}{r.mailSentAt ? <span className="small muted" title={`Email sent ${when(r.mailSentAt)}`}> · ✉</span> : <span className="small t-a" title="Email not marked as sent"> · no email</span>}</span>, csv: (r) => `${r.owner}${r.ownerEmail ? ` <${r.ownerEmail}>` : ""}` },
    { key: "due", label: "Expected closure", value: (r) => r.due, render: (r) => !r.due ? "—" : <span className={r.overdue ? "t-r" : ""} style={{ fontWeight: r.overdue ? 800 : 400 }}>{dayIso(r.due)}{r.overdue ? ` · ${daysBetween(r.due, d.today)}d late` : isOpen(r.status) && r.due <= soon ? " · due soon" : ""}</span> },
    { key: "status", label: "Status", value: (r) => STATUS[r.status], render: (r) => <span className={`pill ${PILL[r.status]}`}>{STATUS[r.status]}</span> },
    { key: "age", label: "Days open", num: true, value: (r) => Math.floor(((r.closed ?? d.now) - r.created) / DAY), hidden: true },
    { key: "updated", label: "Last update", value: (r) => r.updated, render: (r) => { const u = r.updates[r.updates.length - 1]; return <span className="small"><span className="muted">{ago(r.updated, d.now)}</span>{u?.note ? <span className="ell" style={{ maxWidth: 200, display: "inline-block", verticalAlign: "bottom" }} title={u.note}> · {u.note}</span> : null}</span>; }, csv: (r) => r.updates[r.updates.length - 1]?.note ?? "" },
    { key: "prio", label: "Priority", value: (r) => PRIO[r.priority], hidden: true },
    { key: "mail", label: "Email subject", value: (r) => r.mailSubject || null, hidden: true },
  ];

  return (
    <div className="page cc">
      <div className="row2">
        <div>
          <h1>Escalations</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>Raise issues to the right team, follow them to closure, and see where things are stuck. Replaces the action item sheets.</p>
        </div>
        <span className="spacer" />
        {d.canRaise && <button type="button" className="btn primary" onClick={() => setRaising(true)}>+ Raise escalation</button>}
      </div>

      <div className="row2">
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-pressed={tab === "tracker"} aria-selected={tab === "tracker"} onClick={() => setTab("tracker")}>Tracker</button>
          <button type="button" role="tab" aria-pressed={tab === "summary"} aria-selected={tab === "summary"} onClick={() => setTab("summary")}>Leadership summary</button>
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{d.departments.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={city} onChange={(e) => { setCity(e.target.value); setCluster(""); setProp(""); }} aria-label="City"><option value="">All cities</option>{cities.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={cluster} onChange={(e) => { setCluster(e.target.value); setProp(""); }} aria-label="Cluster"><option value="">All clusters</option>{clusters.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={prop} onChange={(e) => setProp(e.target.value)} aria-label="Property"><option value="">All properties</option>{props.map((p) => <option key={p.id} value={String(p.id)}>{p.property}</option>)}</select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Raised to"><option value="">Raised to: anyone</option>{owners.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="Raised by"><option value="">Raised by: anyone</option>{raisers.map((x) => <option key={x}>{x}</option>)}</select>
        {anyFilter && <button type="button" className="link small" onClick={() => { setDept(""); setCity(""); setCluster(""); setProp(""); setOwner(""); setBy(""); }}>Clear</button>}
      </div>

      {tab === "tracker" ? <>
        <div className="row2">
          {focus ? <span className="chipn"><b>{focus.label}</b> · {focus.ids.length}<button type="button" className="link small" onClick={() => setFocus(null)} style={{ marginLeft: 6 }}>Show all ×</button></span> :
            <div className="bk">
              {([["open", "Open"], ["overdue", "Past expected closure"], ["soon", "Due in 2 days"], ["closed", "Closed or dropped"], ["all", "All"]] as [Quick, string][]).map(([k, l]) => (
                <button key={k} type="button" className="qf" aria-pressed={quick === k} onClick={() => setQuick(k)}>{l}<span className={`cnt ${k === "overdue" && counts[k] ? "r" : ""}`}>{counts[k]}</span></button>
              ))}
            </div>}
        </div>
        <Table name="Escalations" rows={list} cols={cols} rowKey={(r) => r.id} initialSort={{ key: quick === "closed" ? "updated" : "due", dir: quick === "closed" ? -1 : 1 }}
          search={(r) => `${r.ref} ${r.title} ${r.detail} ${r.owner} ${r.raisedBy} ${r.department} ${r.props.map((p) => `${p.name} ${p.cluster} ${p.city}`).join(" ")} ${r.mailSubject}`}
          empty={d.rows.length ? "No escalations match these filters." : "No escalations yet. Raise the first one."} />
      </> : <Summary d={d} rows={scoped} period={period} setPeriod={setPeriod} show={show} />}

      {cur && <EscDrawer e={cur} d={d} close={() => setOpen(null)} onDone={done} />}
      {raising && <RaiseForm d={d} close={() => { setRaising(false); if (d.openNew) router.push("/escalations"); }} onDone={(msg, id) => { setRaising(false); if (d.openNew) router.push("/escalations"); done(msg, id); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/** Totals for leadership: how many are open, how fast they close, and where they pile up. Every count opens the list behind it. */
function Summary({ d, rows, period, setPeriod, show }: { d: EscData; rows: Esc[]; period: string; setPeriod: (p: string) => void; show: (label: string, rows: Esc[]) => void }) {
  const days = PERIODS.find(([k]) => k === period)![2];
  const since = d.now - days * DAY;
  const pLabel = PERIODS.find(([k]) => k === period)![1].toLowerCase();
  const openRows = rows.filter((r) => isOpen(r.status));
  const overdue = rows.filter((r) => r.overdue);
  const raised = rows.filter((r) => r.created >= since);
  const closed = rows.filter((r) => r.status === "done" && (r.closed ?? 0) >= since);
  const onTime = closed.filter((r) => r.onTime);
  const closeDays = (l: Esc[]) => median(l.map((r) => ((r.closed ?? d.now) - r.created) / DAY));
  const C = ({ l, label }: { l: Esc[]; label: string }) => l.length ? <button type="button" className="num" onClick={() => show(label, l)}>{l.length}</button> : <span className="muted">0</span>;

  type G = { key: string; rows: Esc[] };
  const group = (keyOf: (r: Esc) => string[]) => {
    const m = new Map<string, Esc[]>();
    for (const r of rows) for (const k of keyOf(r)) m.set(k, [...(m.get(k) ?? []), r]);
    return [...m].map(([key, l]) => ({ key, rows: l }));
  };
  const stat = (g: G) => {
    const o = g.rows.filter((r) => isOpen(r.status)), od = g.rows.filter((r) => r.overdue), rs = g.rows.filter((r) => r.created >= since);
    const cl = g.rows.filter((r) => r.status === "done" && (r.closed ?? 0) >= since), ot = cl.filter((r) => r.onTime);
    const oldest = o.length ? Math.max(...o.map((r) => (d.now - r.created) / DAY)) : null;
    return { ...g, open: o, overdue: od, raised: rs, closed: cl, onTime: ot, med: closeDays(cl), oldest };
  };
  type S = ReturnType<typeof stat>;
  const gcols = (label: string, extra?: Col<S>[]): Col<S>[] => [
    { key: "key", label, value: (s) => s.key, render: (s) => <b>{s.key}</b>, sticky: true },
    { key: "open", label: "Open", num: true, value: (s) => s.open.length, render: (s) => <C l={s.open} label={`Open · ${s.key}`} /> },
    { key: "overdue", label: "Past expected closure", num: true, value: (s) => s.overdue.length, render: (s) => <span className={s.overdue.length ? "t-r" : ""}><C l={s.overdue} label={`Past expected closure · ${s.key}`} /></span> },
    { key: "raised", label: `Raised (${pLabel})`, num: true, value: (s) => s.raised.length, render: (s) => <C l={s.raised} label={`Raised · ${s.key}`} /> },
    { key: "closed", label: `Closed (${pLabel})`, num: true, value: (s) => s.closed.length, render: (s) => <C l={s.closed} label={`Closed · ${s.key}`} /> },
    { key: "ontime", label: "Closed on time", num: true, value: (s) => (s.closed.length ? s.onTime.length / s.closed.length : null), render: (s) => pct(s.onTime.length, s.closed.length), csv: (s) => pct(s.onTime.length, s.closed.length) },
    { key: "med", label: "Usual time to close", num: true, value: (s) => s.med, render: (s) => fmtDays(s.med), csv: (s) => fmtDays(s.med) },
    { key: "oldest", label: "Oldest open", num: true, value: (s) => s.oldest, render: (s) => <span className={s.oldest !== null && s.oldest > 7 ? "t-r" : ""}>{s.oldest === null ? "—" : `${Math.floor(s.oldest)}d`}</span>, csv: (s) => (s.oldest === null ? "" : Math.floor(s.oldest)) },
    ...(extra ?? []),
  ];
  const sortBy = (l: S[]) => l.sort((a, b) => b.overdue.length - a.overdue.length || b.open.length - a.open.length || b.raised.length - a.raised.length);
  const byDept = sortBy(group((r) => [r.department]).map(stat));
  const byOwner = sortBy(group((r) => [r.owner]).map(stat));
  const byProp = sortBy(group((r) => r.props.map((p) => p.name)).map(stat));
  const byRaiser = sortBy(group((r) => [r.raisedBy]).map(stat));
  const aging: [string, number, number][] = [["0–2 days", 0, 3], ["3–7 days", 3, 8], ["8–14 days", 8, 15], ["15+ days", 15, 1e9]];
  const ageRows = aging.map(([l, a, b]) => ({ l, rows: openRows.filter((r) => { const x = (d.now - r.created) / DAY; return x >= a && x < b; }) }));
  const maxAge = Math.max(1, ...ageRows.map((x) => x.rows.length));
  // Weekly raised vs closed, last 8 weeks.
  const weeks = Array.from({ length: 6 }, (_, i) => { const end = d.now - (5 - i) * 7 * DAY, start = end - 7 * DAY; return { label: day(start + DAY), raised: rows.filter((r) => r.created >= start && r.created < end), closed: rows.filter((r) => r.status === "done" && r.closed !== null && r.closed >= start && r.closed < end) }; });
  const wMax = Math.max(1, ...weeks.flatMap((w) => [w.raised.length, w.closed.length]));
  const repeat = byProp.filter((s) => s.raised.length >= 2).sort((a, b) => b.raised.length - a.raised.length).slice(0, 5);

  return (
    <>
      <div className="row2"><span className="small muted">Period for raised and closed:</span>
        <div className="seg">{PERIODS.map(([k, l]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div></div>
      <div className="esc-kpis">
        <div className="card esc-kpi"><span className="small muted">Open now</span><b><C l={openRows} label="Open now" /></b><span className="small muted">{openRows.filter((r) => r.status === "open").length} not started yet</span></div>
        <div className={`card esc-kpi ${overdue.length ? "r" : ""}`}><span className="small muted">Past expected closure</span><b><C l={overdue} label="Past expected closure" /></b><span className="small muted">{pct(overdue.length, openRows.length)} of open</span></div>
        <div className="card esc-kpi"><span className="small muted">Raised · {pLabel}</span><b><C l={raised} label={`Raised in ${pLabel}`} /></b><span className="small muted">{raised.filter((r) => r.priority === "high").length} high priority</span></div>
        <div className="card esc-kpi"><span className="small muted">Closed · {pLabel}</span><b><C l={closed} label={`Closed in ${pLabel}`} /></b><span className="small muted">{pct(onTime.length, closed.length)} by expected date</span></div>
        <div className="card esc-kpi"><span className="small muted">Usual time to close <InfoTip title="Usual time to close" rows={[["Means", "Median time from raising to closing, for escalations closed in the period"]]} /></span><b>{fmtDays(closeDays(closed))}</b><span className="small muted">median</span></div>
      </div>

      <div className="grid g2h">
        <Sec title="How long open ones have waited" tip={<InfoTip title="How long open ones have waited" rows={[["Counts", "Open escalations by days since they were raised"]]} />}>
          <div className="stages">{ageRows.map((x) => (
            <div key={x.l} className="stage" style={{ gridTemplateColumns: "90px minmax(0,1fr) 40px" }}>
              <span className="small" style={{ fontWeight: 700 }}>{x.l}</span>
              <div className="bar"><i style={{ width: `${(x.rows.length / maxAge) * 100}%`, background: x.l.startsWith("15") || x.l.startsWith("8") ? "var(--red)" : "var(--blue)" }} /></div>
              <span className="small n"><C l={x.rows} label={`Open ${x.l}`} /></span>
            </div>
          ))}</div>
        </Sec>
        <Sec title="Raised vs closed, by week" tip={<InfoTip title="Raised vs closed" rows={[["Bars", "Escalations raised (blue) and closed (green) each week, last 6 weeks"], ["Click", "A bar to see them"]]} />}>
          <div className="esc-weeks">{weeks.map((w) => (
            <div key={w.label} className="esc-week">
              <div className="esc-bars">
                <button type="button" title={`${w.raised.length} raised`} style={{ height: `${(w.raised.length / wMax) * 100}%`, background: "var(--blue)" }} onClick={() => w.raised.length && show(`Raised week of ${w.label}`, w.raised)} />
                <button type="button" title={`${w.closed.length} closed`} style={{ height: `${(w.closed.length / wMax) * 100}%`, background: "var(--green)" }} onClick={() => w.closed.length && show(`Closed week of ${w.label}`, w.closed)} />
              </div>
              <span className="small muted">{w.label}</span>
            </div>
          ))}</div>
        </Sec>
      </div>

      <Sec title="By department" tip={<InfoTip title="By department" rows={[["Closed on time", "Closed on or before the expected closure date"], ["Usual time to close", "Median days from raising to closing"]]} />}>
        <Table name="Escalations by department" rows={byDept} cols={gcols("Department")} rowKey={(s) => s.key} pageSize={10} />
      </Sec>
      <Sec title="By who it was raised to" tip={<InfoTip title="By who it was raised to" rows={[["Means", "The team or person who has to act. Shows who is slow to close"]]} />}>
        <Table name="Escalations by owner" rows={byOwner} cols={gcols("Raised to")} rowKey={(s) => s.key} pageSize={10} />
      </Sec>
      <div className="grid g2w">
        <Sec title="By property" tip={<InfoTip title="By property" rows={[["Means", "An escalation covering two properties counts for both"]]} />}>
          <Table name="Escalations by property" rows={byProp} cols={gcols("Property")} rowKey={(s) => s.key} pageSize={10} />
        </Sec>
        <Sec title="Properties raised most often" tip={<InfoTip title="Properties raised most often" rows={[["Means", `Properties with 2 or more escalations raised in ${pLabel}. Worth a visit`]]} />}>
          {!repeat.length ? <p className="small muted">No property had more than one escalation in this period.</p> :
            <ul className="cmp-list">{repeat.map((s) => <li key={s.key}><b>{s.key}</b>: <C l={s.raised} label={`Raised · ${s.key}`} /> raised <span className="muted">({[...new Set(s.raised.map((r) => r.department))].join(", ")})</span></li>)}</ul>}
        </Sec>
      </div>
      <Sec title="By who raised it" tip={<InfoTip title="By who raised it" rows={[["Means", "Central team members who raised escalations, and how many of theirs are still open"]]} />}>
        <Table name="Escalations by raiser" rows={byRaiser} cols={gcols("Raised by")} rowKey={(s) => s.key} pageSize={10} />
      </Sec>
    </>
  );
}

function emailText(e: { title: string; detail: string; owner: string; ownerEmail: string; cc: string; mailSubject: string; due: string | null; props: { name: string }[]; ref?: string; photos: string[] }, me: string) {
  const subject = e.mailSubject || `Escalation: ${e.title}`;
  const body = [`Hi ${e.owner},`, "", `${e.detail || e.title}`, "", `Property: ${e.props.map((p) => p.name).join(", ")}`, e.due ? `Expected closure: ${dayIso(e.due)}` : "", e.ref ? `Reference: ${e.ref}` : "",
    e.photos.length ? `Photos: ${e.photos.length} attached in ZoTask` : "", "", "Please confirm the plan and the date it will be closed.", "", "Thanks,", me].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  return { subject, body, text: `To: ${e.owner}${e.ownerEmail ? ` <${e.ownerEmail}>` : ""}\n${e.cc ? `Cc: ${e.cc}\n` : ""}Subject: ${subject}\n\n${body}`, mailto: `mailto:${encodeURIComponent(e.ownerEmail)}?${e.cc ? `cc=${encodeURIComponent(e.cc)}&` : ""}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

function EscDrawer({ e, d, close, onDone }: { e: Esc; d: EscData; close: () => void; onDone: (msg: string, id?: number) => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(e.status);
  const [due, setDue] = useState(e.due ?? "");
  const [note, setNote] = useState("");
  const [mailSent, setMailSent] = useState(!!e.mailSentAt);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mail, setMail] = useState(false);
  useEffect(() => { setStatus(e.status); setDue(e.due ?? ""); setNote(""); setMailSent(!!e.mailSentAt); setPhotos([]); setErr(""); }, [e.id, e.status, e.due, e.mailSentAt]);
  const save = async () => {
    setBusy(true); setErr("");
    const r = await updateEscalation(e.id, { status, due: due || undefined, note, mailSent: mailSent && !e.mailSentAt, photos });
    setBusy(false);
    if (r.ok) onDone(r.msg ?? "Updated"); else setErr(r.error);
  };
  const m = emailText(e, d.me);
  const changed = status !== e.status || (due || null) !== e.due || note.trim() || (mailSent && !e.mailSentAt) || photos.length;
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer wide" role="dialog" aria-label={`${e.ref} details`}>
        <div className="dh">
          <div style={{ minWidth: 0 }}>
            <h2>{e.title}</h2>
            <p>{e.ref} · {e.department} · raised {when(e.created)} by {e.raisedBy}</p>
          </div>
          <button type="button" className="x" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="db">
          <div className="row2">
            <span className={`pill ${PILL[e.status]}`}>{STATUS[e.status]}</span>
            <span className={`pill ${e.priority === "high" ? "r" : e.priority === "medium" ? "a" : ""}`}>{PRIO[e.priority]} priority</span>
            {e.overdue && e.due && <span className="pill r">{daysBetween(e.due, d.today)}d past expected closure</span>}
            {e.closed && <span className="small muted">Closed {when(e.closed)}{e.onTime === false ? " · after expected date" : e.onTime ? " · on time" : ""}</span>}
          </div>
          {e.detail && <p style={{ margin: 0 }}>{e.detail}</p>}
          <dl className="kv">
            <dt>Property</dt><dd>{e.props.map((p) => `${p.name} (${p.cluster}, ${p.city})`).join("; ")}</dd>
            <dt>Raised to</dt><dd>{e.owner}{e.ownerEmail ? <span className="muted"> · {e.ownerEmail}</span> : null}</dd>
            {e.cc && <><dt>Cc</dt><dd>{e.cc}</dd></>}
            <dt>Expected closure</dt><dd>{e.due ? dayIso(e.due) : "—"}</dd>
            <dt>Email</dt><dd>{e.mailSentAt ? <>Sent {when(e.mailSentAt)}{e.mailSubject ? <span className="muted"> · “{e.mailSubject}”</span> : null}</> : <span className="t-a">Not marked as sent</span>}</dd>
            {e.link && <><dt>Link</dt><dd><a href={e.link} target="_blank" rel="noreferrer">{e.link}</a></dd></>}
            {e.task && <><dt>From task</dt><dd><button type="button" className="link" onClick={() => router.push(`/review/${e.instanceId}`)}>{e.task}</button></dd></>}
          </dl>
          {e.photos.length > 0 && <div className="photos">{e.photos.map((p, i) => <Photo key={i} name={p} />)}</div>}

          <div>
            <h3>Updates</h3>
            <ul className="tl">{e.updates.map((u) => (
              <li key={u.id} className={u.status === "done" ? "g" : u.status === "dropped" ? "" : u.status === "open" ? "a" : "b"}>
                {u.note ?? "Updated"}<small>{when(u.at)}{u.by ? ` · ${u.by}` : ""}</small>
              </li>
            ))}</ul>
          </div>

          {e.canEdit && <div className="grid" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>Add an update</h3>
            <div className="row2">
              <label className="f" style={{ flex: "1 1 160px" }}>Status
                <select value={status} onChange={(x) => setStatus(x.target.value)}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="f" style={{ flex: "1 1 160px" }}>Expected closure
                <input type="date" value={due} onChange={(x) => setDue(x.target.value)} /></label>
            </div>
            <label className="f">Note
              <textarea value={note} onChange={(x) => setNote(x.target.value)} placeholder="What happened, who you spoke to, what's next" rows={3} /></label>
            <div className="row2">
              {!e.mailSentAt && <label className="switch small"><input type="checkbox" checked={mailSent} onChange={(x) => setMailSent(x.target.checked)} />Email has been sent</label>}
              <PhotoAdd photos={photos} setPhotos={setPhotos} />
            </div>
            {err && <div className="err">{err}</div>}
          </div>}
        </div>
        <div className="df">
          <button type="button" className="btn sm" onClick={() => setMail(true)}>Email draft</button>
          <span className="spacer" />
          {e.canEdit && <button type="button" className="btn sm primary" disabled={busy || !changed} onClick={save}>{busy ? "Saving…" : "Save update"}</button>}
        </div>
      </aside>
      {mail && <MailModal m={m} close={() => setMail(false)} />}
    </>
  );
}

function MailModal({ m, close }: { m: ReturnType<typeof emailText>; close: () => void }) {
  return <CopyModal title="Email draft" text={m.text} close={close} extra={<a className="btn" href={m.mailto} target="_blank" rel="noreferrer">Open in mail app</a>} />;
}

function PhotoAdd({ photos, setPhotos }: { photos: string[]; setPhotos: (p: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    const names: string[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      const fd = new FormData(); fd.append("file", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) names.push((await res.json()).name);
    }
    setBusy(false);
    setPhotos([...photos, ...names]);
  };
  return (
    <span className="row2">
      {photos.length > 0 && <span className="photos">{photos.map((p, i) => <Photo key={i} name={p} />)}</span>}
      <label className="btn sm">{busy ? "Uploading…" : "Add photos"}<input type="file" accept="image/*" multiple hidden onChange={(x) => add(x.target.files)} /></label>
    </span>
  );
}

function RaiseForm({ d, close, onDone }: { d: EscData; close: () => void; onDone: (msg: string, id?: number) => void }) {
  const t = d.fromTask;
  const guessDept = (c?: string) => (!c ? "R&M" : /house|hk/i.test(c) ? "Housekeeping" : /sales/i.test(c) ? "Sales" : /facil|oper/i.test(c) ? "R&M" : "Other");
  const [department, setDepartment] = useState(guessDept(t?.category));
  const [propertyIds, setPropertyIds] = useState<number[]>(t ? [t.property_id] : []);
  const [title, setTitle] = useState(t ? `${t.task} - ${t.property}` : "");
  const [detail, setDetail] = useState("");
  const [priority, setPriority] = useState("medium");
  const [ownerName, setOwnerName] = useState(d.teams[guessDept(t?.category)]?.[0] ?? "");
  const [ownerEmail, setOwnerEmail] = useState(d.teams[guessDept(t?.category)]?.[1] ?? "");
  const [cc, setCc] = useState("");
  const [due, setDue] = useState(addDays(d.today, PRIO_DAYS.medium));
  const [dueTouched, setDueTouched] = useState(false);
  const [mailSent, setMailSent] = useState(false);
  const [mailSubject, setMailSubject] = useState("");
  const [link, setLink] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mail, setMail] = useState(false);
  const contacts = useMemo(() => [...Object.entries(d.teams).map(([k, [n, e]]) => ({ name: n, email: e, sub: k })), ...d.people.map((p) => ({ name: p.name, email: p.email, sub: p.access_role.toUpperCase() === "CBM" ? "CBM" : p.access_role }))], [d.teams, d.people]);
  const props = d.geo;
  const pickDept = (x: string) => { setDepartment(x); const tm = d.teams[x]; if (tm && (!ownerName || Object.values(d.teams).some(([n]) => n === ownerName))) { setOwnerName(tm[0]); setOwnerEmail(tm[1]); } };
  const pickPrio = (p: string) => { setPriority(p); if (!dueTouched) setDue(addDays(d.today, PRIO_DAYS[p])); };
  const pickOwner = (n: string) => { setOwnerName(n); const c = contacts.find((x) => x.name === n); if (c) setOwnerEmail(c.email); };
  const subject = mailSubject || (title ? `Escalation: ${title}` : "");
  const submit = async () => {
    setBusy(true); setErr("");
    const r = await raiseEscalation({ department, title, detail, priority, propertyIds, ownerName, ownerEmail, cc, due, mailSent, mailSubject: subject, link, photos, instanceId: t?.id ?? null });
    setBusy(false);
    if (r.ok) onDone(r.msg ?? "Raised", (r as { id?: number }).id); else setErr(r.error);
  };
  const draft = emailText({ title, detail, owner: ownerName || "team", ownerEmail, cc, mailSubject: subject, due, props: props.filter((p) => propertyIds.includes(p.id)).map((p) => ({ name: p.property })), photos }, d.me);
  return (
    <div className="modal" onClick={close}>
      <div className="mcard wide esc-form" onClick={(x) => x.stopPropagation()} role="dialog" aria-label="Raise escalation">
        <div className="row2"><h2 style={{ margin: 0 }}>Raise escalation</h2><span className="spacer" /><button type="button" className="x" onClick={close} aria-label="Close">×</button></div>
        {t && <p className="small muted" style={{ margin: 0 }}>From task: <b>{t.task}</b> · {t.property} · {dayIso(t.task_date)}. It will show on the task&apos;s history.</p>}
        <div className="esc-grid">
          <label className="f">Department
            <select value={department} onChange={(x) => pickDept(x.target.value)}>{d.departments.map((x) => <option key={x}>{x}</option>)}</select></label>
          <div className="f">Priority
            <span className="seg" role="group" aria-label="Priority">{Object.entries(PRIO).map(([k, l]) => <button key={k} type="button" aria-pressed={priority === k} onClick={() => pickPrio(k)}>{l}</button>)}</span></div>
          <div className="f span2">Property
            <span className="row2">
              {propertyIds.map((id) => <span key={id} className="cmp-chip">{props.find((p) => p.id === id)?.property}<button type="button" aria-label="Remove" onClick={() => setPropertyIds(propertyIds.filter((x) => x !== id))}>×</button></span>)}
              <select value="" onChange={(x) => x.target.value && setPropertyIds([...propertyIds, Number(x.target.value)])} aria-label="Add property">
                <option value="">{propertyIds.length ? "+ Add another" : "Pick a property"}</option>
                {props.filter((p) => !propertyIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.property} · {p.cluster}</option>)}
              </select>
            </span></div>
          <label className="f span2">What is the issue
            <input type="text" value={title} onChange={(x) => setTitle(x.target.value)} placeholder="e.g. Washing machine repair - Zolo Arcadia" /></label>
          <label className="f span2">Details
            <textarea rows={3} value={detail} onChange={(x) => setDetail(x.target.value)} placeholder="What you saw, since when, impact on residents" /></label>
          <label className="f">Raised to
            <input type="text" list="esc-contacts" value={ownerName} onChange={(x) => pickOwner(x.target.value)} placeholder="Team or person" />
            <datalist id="esc-contacts">{contacts.map((c) => <option key={c.name + c.email} value={c.name}>{c.sub}</option>)}</datalist></label>
          <label className="f">Their email
            <input type="email" value={ownerEmail} onChange={(x) => setOwnerEmail(x.target.value)} placeholder="name@zolostays.com" /></label>
          <label className="f">Cc
            <input type="text" value={cc} onChange={(x) => setCc(x.target.value)} placeholder="Optional, comma separated" /></label>
          <label className="f">Expected closure
            <input type="date" value={due} min={d.today} onChange={(x) => { setDue(x.target.value); setDueTouched(true); }} /></label>
          <label className="f span2">Email subject
            <input type="text" value={subject} onChange={(x) => setMailSubject(x.target.value)} placeholder="Subject of the escalation email" /></label>
          <label className="f span2">Supporting link
            <input type="url" value={link} onChange={(x) => setLink(x.target.value)} placeholder="Optional: ticket, sheet or mail thread link" /></label>
        </div>
        <div className="row2">
          <PhotoAdd photos={photos} setPhotos={setPhotos} />
          <span className="spacer" />
          <label className="switch small"><input type="checkbox" checked={mailSent} onChange={(x) => setMailSent(x.target.checked)} />Email already sent</label>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row2">
          <button type="button" className="btn primary" disabled={busy || !title.trim() || !propertyIds.length || !ownerName.trim()} onClick={submit}>{busy ? "Raising…" : "Raise escalation"}</button>
          <button type="button" className="btn" disabled={!title.trim()} onClick={() => setMail(true)}>Email draft</button>
          <span className="small muted">Expected closure defaults to 1, 3 or 7 days by priority.</span>
        </div>
      </div>
      {mail && <div onClick={(x) => x.stopPropagation()}><MailModal m={draft} close={() => setMail(false)} /></div>}
    </div>
  );
}
