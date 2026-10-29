"use client";
// Why it's happening: trends, the task lifecycle, rejection reasons, recurring patterns and city/cluster comparison.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CC } from "@/lib/command";
import { InfoTip, N, Sec, Table, dur, fmtP, pct, rag, useDrill } from "./parts";

type Pt = Record<string, number[][] | null> | null;
const METRICS: { key: string; label: string; rate: boolean; goodUp: boolean; tip: string }[] = [
  { key: "onTime", label: "Done on time", rate: true, goodUp: true, tip: "Tasks submitted by the deadline ÷ tasks past deadline that day" },
  { key: "inSla", label: "Reviewed on time", rate: true, goodUp: true, tip: "Tasks reviewed that day with every review on time ÷ tasks reviewed that day" },
  { key: "fta", label: "Approved first time", rate: true, goodUp: true, tip: "Approved on the first review ÷ tasks reviewed at least once" },
  { key: "approved", label: "Approved (any attempt)", rate: true, goodUp: true, tip: "Tasks approved at any attempt ÷ tasks past deadline" },
  { key: "overdue", label: "Not done or missed", rate: false, goodUp: false, tip: "Tasks with a deadline that day that are still open or were missed" },
  { key: "backlog", label: "Waiting for review", rate: false, goodUp: false, tip: "Tasks waiting for review at the end of the day" },
  { key: "rejections", label: "Tasks sent back", rate: false, goodUp: false, tip: "Tasks sent back for changes that day" },
  { key: "repeatRate", label: "Sent back again", rate: true, goodUp: false, tip: "Send-backs on a second or later attempt ÷ all send-backs that day" },
];
const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Merges day points into weeks. Rates add numerators and denominators, counts add up, the backlog takes the last day. */
function bucketize(points: Pt[], days: string[], weekly: boolean) {
  if (!weekly) return points.map((p, i) => ({ p, label: nice(days[i]) }));
  const out: { p: Pt; label: string }[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const chunk = points.slice(i, i + 7), real = chunk.filter(Boolean) as NonNullable<Pt>[];
    if (!real.length) { out.push({ p: null, label: `Wk of ${nice(days[i])}` }); continue; }
    const merged: NonNullable<Pt> = {};
    for (const m of METRICS) {
      if (m.key === "backlog") { const last = [...real].reverse().find((x) => x.backlog); merged.backlog = last?.backlog ?? null; continue; }
      const parts = real.map((x) => x[m.key]).filter(Boolean) as number[][][];
      merged[m.key] = parts.length ? parts[0].map((_, j) => [...new Set(parts.flatMap((x) => x[j]))]) : null;
    }
    out.push({ p: merged, label: `Wk of ${nice(days[i])}` });
  }
  return out;
}
const valueOf = (p: Pt, key: string, rate: boolean) => {
  const v = p?.[key];
  if (!v) return null;
  return rate ? pct(v[0].length, v[1].length) : v[0].length;
};

function Chart({ m, cur, prev, showPrev }: { m: (typeof METRICS)[number]; cur: { p: Pt; label: string }[]; prev: { p: Pt; label: string }[]; showPrev: boolean }) {
  const { open } = useDrill();
  const [hover, setHover] = useState<number | null>(null);
  const cv = cur.map((x) => valueOf(x.p, m.key, m.rate)), pv = prev.map((x) => valueOf(x.p, m.key, m.rate));
  const max = m.rate ? 100 : Math.max(4, ...cv.filter((x): x is number => x !== null), ...(showPrev ? pv.filter((x): x is number => x !== null) : []));
  const W = 300, H = 110, L = 28, B = 18, n = cur.length;
  const x = (i: number) => L + (n === 1 ? (W - L) / 2 : (i * (W - L - 8)) / (n - 1));
  const y = (v: number) => 6 + (1 - v / max) * (H - B - 6);
  const path = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).reduce<string[][]>((acc, p) => { if (p === null) acc.push([]); else acc[acc.length - 1].push(p); return acc; }, [[]]).filter((s) => s.length);
  const last = [...cv].reverse().find((v) => v !== null) ?? null;
  const h = hover !== null ? hover : null;
  return (
    <div className="chart">
      <div className="row2" style={{ gap: 4 }}><b className="small">{m.label}</b><InfoTip title={m.label} rows={[["Means", m.tip], ["Line", "This period. Dashed: the period before"], ["Click", "A point to see its tasks"]]} /><span className="spacer" />
        <span className="small"><b>{last === null ? "—" : m.rate ? `${last}%` : last}</b> <span className="muted">latest</span></span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${m.label} trend`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--line2)" /><text x={L - 4} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill="var(--faint)">{Math.round(max * f)}{m.rate ? "%" : ""}</text></g>)}
        {showPrev && path(pv).map((s, i) => <polyline key={`p${i}`} points={s.join(" ")} fill="none" stroke="var(--faint)" strokeWidth="1.4" strokeDasharray="4 3" />)}
        {path(cv).map((s, i) => <polyline key={`c${i}`} points={s.join(" ")} fill="none" stroke="var(--blue)" strokeWidth="2" />)}
        {cv.map((v, i) => v === null ? null : (
          <circle key={i} cx={x(i)} cy={y(v)} r={h === i ? 5 : 3} fill={h === i ? "var(--blue-d)" : "var(--blue)"} style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
            onClick={() => { const ids = cur[i].p?.[m.key]?.[m.rate ? 1 : 0] ?? []; open({ title: `${m.label} · ${cur[i].label}`, note: m.tip, ids }); }} />
        ))}
        {[0, n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => <text key={i} x={x(i)} y={H - 4} fontSize="9" textAnchor={i === 0 ? "start" : "end"} fill="var(--faint)">{cur[i]?.label}</text>)}
      </svg>
      <div className="small muted chart-tip">{h !== null ? <>{cur[h].label}: <b style={{ color: "var(--fg)" }}>{cv[h] === null ? "no data" : m.rate ? `${cv[h]}%` : cv[h]}</b>
        {m.rate && cur[h].p?.[m.key] ? ` (${cur[h].p![m.key]![0].length} of ${cur[h].p![m.key]![1].length})` : ""}
        {showPrev ? ` · before: ${pv[h] === null || pv[h] === undefined ? "no data" : m.rate ? `${pv[h]}%` : pv[h]}` : ""}</> : "Hover a point for values, click it for the tasks."}</div>
    </div>
  );
}

export function Trends({ d }: { d: CC }) {
  const [sel, setSel] = useState<string[]>(["onTime", "inSla", "fta", "backlog"]);
  const [weekly, setWeekly] = useState(false);
  const [showPrev, setShowPrev] = useState(true);
  const canWeek = d.trend.days.length >= 14;
  const cur = useMemo(() => bucketize(d.trend.cur, d.trend.days, weekly && canWeek), [d, weekly, canWeek]);
  const prev = useMemo(() => bucketize(d.trend.prev, d.trend.days, weekly && canWeek), [d, weekly, canWeek]);
  return (
    <Sec title="Trends" tip={<InfoTip title="Trends" rows={[["Data", "Calculated from task records. Days before the first record are left blank, not zero"], ["Range", d.trend.days.length > d.R.days ? "Short periods show the 7 days ending on the selected day" : "The selected period"]]} note={`Records start on ${nice(d.trend.firstData)} in this prototype.`} />}
      right={<span className="row2">
        <span className="seg"><button type="button" aria-pressed={!weekly} onClick={() => setWeekly(false)}>Daily</button><button type="button" aria-pressed={weekly && canWeek} disabled={!canWeek} title={canWeek ? "" : "Pick 14 days or more for weekly"} onClick={() => setWeekly(true)}>Weekly</button></span>
        <label className="switch small"><input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} />Previous period</label>
      </span>}>
      <div className="bk">{METRICS.map((m) => <button key={m.key} type="button" aria-pressed={sel.includes(m.key)} onClick={() => setSel(sel.includes(m.key) ? sel.filter((x) => x !== m.key) : [...sel, m.key])}>{m.label}</button>)}</div>
      {!sel.length ? <p className="muted small">Pick a metric above.</p> : <div className="charts">{METRICS.filter((m) => sel.includes(m.key)).map((m) => <Chart key={m.key} m={m} cur={cur} prev={prev} showPrev={showPrev} />)}</div>}
    </Sec>
  );
}

export function Lifecycle({ d }: { d: CC }) {
  const L = d.lifecycle, due = L.stages[0].ids.length;
  const Row = ({ s, base, prevN }: { s: { label: string; ids: number[]; time?: number | null; timeLabel?: string }; base: number; prevN: number | null }) => (
    <div className="stage">
      <span className="small" style={{ fontWeight: 700 }}>{s.label}</span>
      <div className="bar"><i style={{ width: `${base ? (s.ids.length / base) * 100 : 0}%`, background: "var(--blue)" }} /></div>
      <span className="small n"><N ids={s.ids} title={s.label} /></span>
      <span className="small muted n">{prevN === null ? "" : fmtP(pct(s.ids.length, prevN))}</span>
      <span className="small muted">{s.time !== undefined ? `${dur(s.time ?? null)} ${s.timeLabel}` : ""}</span>
    </div>
  );
  return (
    <Sec title="Task lifecycle" tip={<InfoTip title="Task lifecycle" rows={[["Counts", "Tasks past deadline in the period, each counted once however many times it was reviewed"], ["%", "Share of the step before"], ["Time", "Median time for that step"], ["Stuck now", "All open tasks in the filters, any date"]]} />}
      right={<span className="small">Approved (any attempt) <b>{fmtP(pct(L.finalApproved.length, due))}</b> <span className="muted">({L.finalApproved.length} of {due})</span></span>}>
      {!due ? <p className="muted">No task deadlines passed in this period.</p> : <>
        <div className="stages">{L.stages.map((s, i) => <Row key={s.key} s={s} base={due} prevN={i ? L.stages[i - 1].ids.length : null} />)}</div>
        <div className="small muted" style={{ fontWeight: 700, marginTop: 4 }}>When a task is sent back</div>
        <div className="stages">{L.fix.map((s, i) => <Row key={s.key} s={s} base={due} prevN={i ? L.fix[i - 1].ids.length : L.stages[2].ids.length} />)}</div>
        <div className="row2 small" style={{ marginTop: 4 }}><span className="muted">Stuck now:</span>{L.stuck.map((s) => <span key={s.label} className="chipn"><N ids={s.ids} title={`Stuck: ${s.label}`} /> {s.label}</span>)}</div>
      </>}
    </Sec>
  );
}

export function Reasons({ d }: { d: CC }) {
  const max = Math.max(1, ...d.reasons.map((r) => r.ids.length));
  const groups = [...new Set(d.reasons.map((r) => r.group))].map((g) => ({ g, ids: [...new Set(d.reasons.filter((r) => r.group === g).flatMap((r) => r.ids))] }));
  return (
    <Sec title="Why tasks get sent back" tip={<InfoTip title="Why tasks get sent back" rows={[["Count", "Tasks sent back for that reason in the period. One task can have more than one reason"], ["% of reviewed", `Share of the ${d.reviewedTotal} tasks reviewed in the period`], ["Most affected", "Property with the most of these"]]} note="New: ZoTask doesn't collect reasons today. This prototype adds a reason picker to the review step." />}
      right={<span className="small"><N ids={d.reasonsTotal} title="All tasks sent back" /> tasks <span className="muted">· {d.prevHasData ? `${d.reasonsPrevTotal} before` : "no earlier data"}</span></span>}>
      {!d.reasons.length ? <p className="muted">No tasks were sent back in this period.</p> : <>
        <div className="row2 small">{groups.map((g) => <span key={g.g} className="chipn"><N ids={g.ids} title={`${g.g} problems`} /> {g.g}</span>)}</div>
        <div className="reasons">
          {d.reasons.map((r) => (
            <div key={r.reason} className="rrow">
              <span className="small" style={{ fontWeight: 700 }}>{r.reason}</span>
              <div className="bar"><i style={{ width: `${(r.ids.length / max) * 100}%`, background: "var(--amber)" }} /></div>
              <span className="small n"><N ids={r.ids} title={`Sent back: ${r.reason}`} /></span>
              <span className="small muted n">{fmtP(r.share)}</span>
              {d.prevHasData ? <span className={`small n ${r.ids.length > r.prev ? "t-r" : r.ids.length < r.prev ? "t-g" : "muted"}`} title={`${r.prev} in the previous period`}>{r.ids.length === r.prev ? "=" : `${r.ids.length > r.prev ? "+" : ""}${r.ids.length - r.prev}`}</span> : <span className="small muted n" title="No records for the previous period">—</span>}
              <span className="small muted ell">{r.topProperty ? `${r.topProperty[0]} (${r.topProperty[1]})` : ""}</span>
            </div>
          ))}
        </div>
      </>}
    </Sec>
  );
}

export function Recurring({ d }: { d: CC }) {
  return (
    <Sec title="Recurring problems" tip={<InfoTip title="Recurring problems" rows={[["Missed", "Same task missed 2+ times at a property"], ["Sent back", "Same task sent back on 3+ days"], ["Reason", "Same reason 3+ times at a property"], ["Reviews", "A cluster where 30%+ of tasks were reviewed late"]]} note="One-off incidents are left out." />}>
      {!d.recurring.length ? <p className="muted">No repeating patterns in this period.</p> : (
        <div className="grid" style={{ gap: 0 }}>{d.recurring.map((r, i) => (
          <div key={i} className="att" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
            <div style={{ minWidth: 0 }}><div className="tname" style={{ fontSize: 13.5 }}>{r.title}</div><div className="tsub">{r.sub}</div></div>
            <span className="small muted">{r.owner}</span>
            <N ids={r.ids} title={r.title} className="btn sm">{`${r.ids.length} tasks`}</N>
          </div>
        ))}</div>
      )}
    </Sec>
  );
}

export function Compare({ d }: { d: CC }) {
  const router = useRouter();
  const [lvl, setLvl] = useState<"city" | "cluster">(d.filters.city ? "cluster" : "city");
  const rowsC = lvl === "city" ? d.cities : d.clusters;
  const go = (name: string, city: string) => {
    const p = new URLSearchParams(Object.entries({ range: d.preset, from: d.preset === "custom" ? d.R.from : "", to: d.preset === "custom" ? d.R.to : "", cat: d.filters.cat ?? "", rv: d.filters.rv ?? "", mine: d.role === "reviewer" && !d.mine ? "0" : "", city, cluster: lvl === "cluster" ? name : "" }).filter(([, v]) => v) as [string, string][]);
    router.push(`/dashboard?${p}`);
  };
  type C = (typeof rowsC)[number];
  const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round(a - b));
  return (
    <Sec title="City and cluster comparison" tip={<InfoTip title="Comparison" rows={[["Order", "Lowest on-time first"], ["Counts", "Shown next to every rate, so small places aren't over- or under-stated"], ["Click a name", "Filters the whole dashboard to it"]]} />}
      right={<span className="seg"><button type="button" aria-pressed={lvl === "city"} onClick={() => setLvl("city")}>Cities</button><button type="button" aria-pressed={lvl === "cluster"} onClick={() => setLvl("cluster")}>Clusters</button></span>}>
      <Table<C> name={lvl === "city" ? "Cities" : "Clusters"} rows={rowsC} rowKey={(r) => r.name} pageSize={20} cols={[
        { key: "name", label: lvl === "city" ? "City" : "Cluster", sticky: true, value: (r) => r.name, render: (r) => <button type="button" className="link" style={{ padding: 0 }} onClick={() => go(r.name, r.city)}>{r.name}</button> },
        ...(lvl === "cluster" ? [{ key: "city", label: "City", value: (r: C) => r.city }] : []),
        { key: "props", label: "Properties", num: true, value: (r) => r.props },
        { key: "due", label: "Deadline passed", num: true, value: (r) => r.due.length, render: (r) => <N ids={r.due} title={`${r.name}: tasks past deadline`} /> },
        { key: "onTime", label: "Done on time", num: true, tip: <InfoTip title="Done on time" rows={[["Means", "Tasks submitted by their deadline"], ["Formula", "On time ÷ tasks past deadline"]]} />, value: (r) => r.onTime, render: (r) => <span className={`pill ${rag(r.onTime, 85, 70)}`}>{fmtP(r.onTime)}</span> },
        { key: "dOn", label: "vs before", num: true, value: (r) => delta(r.onTime, r.onTimePrev), render: (r) => { const x = delta(r.onTime, r.onTimePrev); return x === null ? "—" : <span className={x >= 0 ? "t-g" : "t-r"}>{x > 0 ? "+" : ""}{x}</span>; } },
        { key: "missed", label: "Missed", num: true, value: (r) => r.missed.length, render: (r) => <N ids={r.missed} title={`${r.name}: missed`} /> },
        { key: "fta", label: "Approved first time", num: true, tip: <InfoTip title="Approved first time" rows={[["Means", "Approved at the first review"], ["Formula", "Approved first time ÷ tasks reviewed"]]} />, value: (r) => r.fta, render: (r) => fmtP(r.fta) },
        { key: "inSla", label: "Reviewed on time", num: true, tip: <InfoTip title="Reviewed on time" rows={[["Means", "Reviewed tasks where every review was on time"], ["Formula", "In-time tasks ÷ tasks reviewed"]]} />, value: (r) => r.inSla, render: (r) => <span className={`pill ${rag(r.inSla, 90, 75)}`}>{fmtP(r.inSla)}</span> },
        { key: "over", label: "Waiting too long", num: true, value: (r) => r.over.length, render: (r) => <N ids={r.over} title={`${r.name}: reviews past SLA`} className={r.over.length ? "t-r" : ""} /> },
        { key: "repeat", label: "Sent back 2+ times", num: true, value: (r) => r.repeat.length, render: (r) => <N ids={r.repeat} title={`${r.name}: sent back twice or more`} /> },
      ]} />
    </Sec>
  );
}
