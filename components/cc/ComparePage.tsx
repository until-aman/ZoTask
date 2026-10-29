"use client";
// Two stakeholders side by side: the same task-level metrics as the dashboard, who leads on each, and a written report.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompareData, Kind, Metric } from "@/lib/compare";
import { CopyModal, DrillCtx, Drill, InfoTip, N, Sec, dur, fmtP } from "./parts";
import { DrillDrawer, TaskDrawer } from "./Drawers";

const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const span = (r: { from: string; to: string }) => (r.from === r.to ? nice(r.from) : `${nice(r.from)} – ${nice(r.to)}`);
const PRESETS: [string, string][] = [["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["custom", "Custom"]];
const fmt = (m: Metric, v: number | null) => (m.fmt === "pct" ? fmtP(v) : m.fmt === "dur" ? dur(v) : v === null ? "—" : String(v));
const gapOf = (m: Metric) => (m.a === null || m.b === null ? "" : m.fmt === "pct" ? `${Math.abs(Math.round((m.a - m.b) * 10) / 10)} pts` : m.fmt === "dur" ? dur(Math.abs(m.a - m.b)) : String(Math.abs(m.a - m.b)));
/** "a", "b", "tie", or null when the metric has no better direction or data is missing. */
const lead = (m: Metric) => {
  if (!m.better || m.a === null || m.b === null) return null;
  if (m.a === m.b) return "tie";
  return (m.better === "high") === (m.a > m.b) ? "a" : "b";
};
const MIN_TASKS = 10;

// What to do when someone trails on a metric. Plain, practical, one line each.
const ACTION: Record<string, string> = {
  onTime: "Send a reminder an hour before each deadline and check at shift start who is on duty for each task.",
  late: "Look at which task types finish late and move their window or owner if the timing does not fit the shift.",
  missed: "Go through missed tasks daily with the CBM and confirm each task is assigned to someone who is actually on site.",
  fta: "Share a short photo guide of a correct submission for the most common send-back reasons.",
  approved: "Follow up on tasks still sent back so they get fixed and approved, not left open.",
  repeat: "Call the assignee on any task sent back twice instead of sending it back a third time.",
  fix: "Ask the team to fix sent-back tasks in the same shift. Remind after 2 hours.",
  overdue: "Clear the tasks that are past deadline and still not done today.",
  inSla: "Check the review queue at fixed times, at least twice a shift, and take the oldest tasks first.",
  wait: "Check the review queue at fixed times, at least twice a shift, and take the oldest tasks first.",
  missedRev: "Rebalance properties between reviewers if one person regularly misses the review limit.",
  over: "Clear the tasks waiting past the review limit now.",
  auditFail: "Sit with the auditor on the tasks that failed audit and agree on what a pass looks like.",
};

type Side = "a" | "b";

export default function ComparePage({ data: d }: { data: CompareData }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(d.kind);
  const [a, setA] = useState(d.a?.id ?? "");
  const [b, setB] = useState(d.b?.id ?? "");
  const [preset, setPreset] = useState(PRESETS.some(([k]) => k === d.preset) ? d.preset : "14d");
  const [from, setFrom] = useState(d.R.from);
  const [to, setTo] = useState(d.R.to);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [task, setTask] = useState<{ id: number; fromList: boolean } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  useEffect(() => { setKind(d.kind); setA(d.a?.id ?? ""); setB(d.b?.id ?? ""); }, [d.kind, d.a?.id, d.b?.id]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".tip-pop")) { if (task) setTask(null); else setDrill(null); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [task]);
  const ctx = useMemo(() => ({ tasks: d.tasks, open: (x: Drill) => { setDrill(x); setTask(null); }, task: (id: number) => setTask({ id, fromList: false }) }), [d.tasks]);

  const go = (patch: Record<string, string> = {}) => {
    const v: Record<string, string> = { kind, a, b, range: preset, ...(preset === "custom" ? { from, to } : {}), ...patch };
    if (v.kind !== d.kind) { delete v.a; delete v.b; }
    if (v.range !== "custom") { delete v.from; delete v.to; }
    router.push(`/compare?${new URLSearchParams(Object.entries(v).filter(([, x]) => x))}`);
  };
  const kindLabel = d.kinds.find(([k]) => k === d.kind)?.[1] ?? "";
  const one = kindLabel.replace(/ies$/, "y").replace(/s$/, "");
  const A = d.a, B = d.b;
  const score = { a: 0, b: 0 };
  for (const m of d.metrics) { const l = lead(m); if (l === "a" || l === "b") score[l]++; }
  const volKey = d.kind === "reviewer" ? "reviewed" : "due";
  const vol = d.metrics.find((m) => m.key === volKey);
  const thin = vol ? ([["a", vol.a], ["b", vol.b]] as [Side, number | null][]).filter(([, v]) => (v ?? 0) < MIN_TASKS).map(([s]) => s) : [];
  const nameOf = (s: Side) => (s === "a" ? A?.label : B?.label) ?? "";
  const overall = score.a === score.b ? "Even" : score.a > score.b ? nameOf("a") : nameOf("b");

  const improve = (s: Side) => {
    const o: Side = s === "a" ? "b" : "a";
    return d.metrics.filter((m) => lead(m) === o).map((m) => ({ m, mine: m[s], theirs: m[o], ids: s === "a" ? m.aIds : m.bIds }));
  };
  const strengths = (s: Side) => d.metrics.filter((m) => lead(m) === s);
  const actions = (s: Side) => [...new Set(improve(s).map((x) => ACTION[x.m.key]).filter(Boolean))].slice(0, 4);

  const buildReport = () => {
    if (!A || !B || !d.focus) return "";
    const L: string[] = [];
    const ofTxt = (m: Metric, s: Side) => { const of = s === "a" ? m.aOf : m.bOf, ids = s === "a" ? m.aIds : m.bIds; return m.fmt === "pct" && of !== undefined ? ` (${ids.length} of ${of})` : ""; };
    L.push(`# ${one} comparison: ${A.label} vs ${B.label}`, "");
    L.push(`Period: ${span(d.R)} (${d.R.days} days)`, `Generated: ${new Date(d.now).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, "Counted per task: each task is counted once however many checks or reviews it had.", "");
    L.push("## Summary", "");
    L.push(score.a === score.b ? `Even: each leads on ${score.a} of the metrics that have a better direction.` : `${overall} is ahead, leading on ${Math.max(score.a, score.b)} of ${score.a + score.b} metrics where one side is better.`);
    for (const s of thin) L.push(`Caution: ${nameOf(s)} has only ${s === "a" ? vol?.a : vol?.b} tasks in this period, so its percentages can swing a lot.`);
    L.push("");
    L.push("## Metrics", "", `| Metric | ${A.label} | ${B.label} | Better |`, "|---|---|---|---|");
    for (const m of d.metrics) { const l = lead(m); L.push(`| ${m.label} | ${fmt(m, m.a)}${ofTxt(m, "a")} | ${fmt(m, m.b)}${ofTxt(m, "b")} | ${l === "a" ? A.label : l === "b" ? B.label : l === "tie" ? "Same" : "—"} |`); }
    L.push("");
    for (const s of ["a", "b"] as Side[]) {
      const f = d.focus[s];
      L.push(`## ${nameOf(s)}`, "");
      const st = strengths(s);
      L.push("Doing well:");
      if (!st.length) L.push("- Not ahead on any metric in this period.");
      for (const m of st) L.push(`- ${m.label}: ${fmt(m, m[s])} vs ${fmt(m, m[s === "a" ? "b" : "a"])} (better by ${gapOf(m)})`);
      L.push("", "Needs improvement:");
      const im = improve(s);
      if (!im.length) L.push("- Not behind on any metric in this period.");
      for (const x of im) L.push(`- ${x.m.label}: ${fmt(x.m, x.mine)} vs ${fmt(x.m, x.theirs)} (behind by ${gapOf(x.m)})`);
      if (f.types.length) { L.push("", d.kind === "reviewer" ? "Task types reviewed least on time:" : "Task types done least on time:"); for (const t of f.types) L.push(`- ${t.task}: ${fmtP(t.onTime)} on time of ${t.due}${t.missed ? `, ${t.missed} missed` : ""}`); }
      if (f.reasons.length) { L.push("", "Most common send-back reasons:"); for (const r of f.reasons) L.push(`- ${r.reason}: ${r.ids.length} ${r.ids.length === 1 ? "task" : "tasks"}`); }
      const ac = actions(s);
      if (ac.length) { L.push("", "Recommended actions:"); for (const x of ac) L.push(`- ${x}`); }
      L.push("");
    }
    L.push("---", "Metrics with no better direction (volume, sent back %, re-reviewed) are shown for context and not scored.");
    return L.join("\n");
  };

  const sel = (id: string, v: string, set: (x: string) => void, other: string, label: string) => (
    <select id={id} value={v} onChange={(e) => set(e.target.value)} aria-label={label} disabled={kind !== d.kind}>
      {d.options.map((o) => <option key={o.id} value={o.id} disabled={o.id === other}>{o.label}{o.sub ? ` · ${o.sub}` : ""}</option>)}
    </select>
  );

  return (
    <DrillCtx.Provider value={ctx}>
      <div className="page cc">
        <div className="row2">
          <div>
            <h1>Compare</h1>
            <p className="muted" style={{ margin: "2px 0 0" }}>Put two {kindLabel.toLowerCase()} side by side for {span(d.R)}. Every number opens the tasks behind it.</p>
          </div>
          <span className="spacer" />
          {A && B && <button type="button" className="btn primary" onClick={() => setReport(buildReport())}>Generate report</button>}
        </div>

        <div className="card cmp-ctl">
          <div className="seg" role="group" aria-label="What to compare">
            {d.kinds.map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); go({ kind: k }); }}>{l}</button>)}
          </div>
          <div className="row2">
            <span className="cmp-dot a" aria-hidden="true" />{sel("cmp-a", a, setA, b, `First ${one.toLowerCase()}`)}
            <span className="muted small">vs</span>
            <span className="cmp-dot b" aria-hidden="true" />{sel("cmp-b", b, setB, a, `Second ${one.toLowerCase()}`)}
            <button type="button" className="link small" title="Swap" onClick={() => go({ a: b, b: a })}>⇄ Swap</button>
          </div>
          <div className="row2">
            <div className="seg">{PRESETS.map(([k, l]) => <button key={k} type="button" aria-pressed={preset === k} onClick={() => { setPreset(k); if (k !== "custom") go({ range: k }); }}>{l}</button>)}</div>
            {preset === "custom" && <span className="row2">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><span className="muted">to</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            </span>}
            <button type="button" className="btn sm primary" disabled={!a || !b || a === b || (preset === "custom" && (!from || !to || from > to))} onClick={() => go()}>Compare</button>
          </div>
        </div>

        {!A || !B ? <div className="card empty"><b>Not enough to compare</b>You need at least two {kindLabel.toLowerCase()} you can see.</div> : <>
          <div className="grid g2h">
            {(["a", "b"] as Side[]).map((s) => {
              const o = s === "a" ? A : B, won = score[s], lost = score[s === "a" ? "b" : "a"];
              return (
                <div key={s} className={`card cmp-who ${s}`}>
                  <div className="row2"><span className={`cmp-dot ${s}`} aria-hidden="true" /><b className="cmp-name">{o.label}</b><span className="spacer" />
                    {won !== lost && <span className={`pill ${won > lost ? "g" : "r"}`}>{won > lost ? "Ahead" : "Behind"}</span>}</div>
                  {o.sub && <span className="small muted">{o.sub}</span>}
                  <span className="small">Leads on <b>{won}</b> of {score.a + score.b} scored metrics{thin.includes(s) ? <span className="t-a"> · few tasks, read with care</span> : ""}</span>
                </div>
              );
            })}
          </div>

          <Sec title="Side by side" tip={<InfoTip title="Side by side" rows={[["Counted", "Per task. A task counts once however many checks or reviews it had"], ["Better", "Which side is ahead on that metric. Metrics marked — have no right direction and are not scored"], ["Click", "Any number to see its tasks"]]} />}>
            <div className="tbl"><table className="cmp-tbl">
              <thead><tr><th>Metric</th><th className="n"><span className="cmp-dot a" />{A.label}</th><th className="n"><span className="cmp-dot b" />{B.label}</th><th className="hide-sm" style={{ width: "26%" }}></th><th>Better</th><th className="n">Gap</th></tr></thead>
              <tbody>{d.metrics.map((m) => {
                const l = lead(m), max = m.fmt === "pct" ? 100 : Math.max(1, m.a ?? 0, m.b ?? 0);
                const cell = (s: Side) => {
                  const v = m[s], ids = s === "a" ? m.aIds : m.bIds, of = s === "a" ? m.aOf : m.bOf, who = s === "a" ? A.label : B.label;
                  return <td className={`n ${l === s ? "cmp-win" : ""}`}>
                    {m.fmt === "pct" ? <><N ids={ids} title={`${m.label} · ${who}`} note={m.means}>{fmt(m, v)}</N>{of !== undefined && <span className="small muted"> {ids.length}/{of}</span>}</>
                      : m.fmt === "dur" ? <N ids={ids} title={`${m.label} · ${who}`} note="Tasks this time is based on">{fmt(m, v)}</N>
                      : <N ids={ids} title={`${m.label} · ${who}`} note={m.means} />}
                  </td>;
                };
                return (
                  <tr key={m.key}>
                    <td><span className="row2" style={{ gap: 4, flexWrap: "nowrap" }}>{m.label}<InfoTip title={m.label} rows={[["Means", m.means], ["Better", m.better === "high" ? "Higher" : m.better === "low" ? "Lower" : "Not scored"]]} /></span></td>
                    {cell("a")}{cell("b")}
                    <td className="hide-sm"><div className="cmp-bars">
                      <i className="a" style={{ width: `${((m.a ?? 0) / max) * 100}%` }} />
                      <i className="b" style={{ width: `${((m.b ?? 0) / max) * 100}%` }} />
                    </div></td>
                    <td>{l === "a" || l === "b" ? <span className={`cmp-tag ${l}`}>{l === "a" ? A.label : B.label}</span> : <span className="muted small">{l === "tie" ? "Same" : "—"}</span>}</td>
                    <td className="n small muted">{l && l !== "tie" ? gapOf(m) : ""}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Sec>

          {d.series && <TrendAB days={d.series.days} a={d.series.a} b={d.series.b} label={d.series.label} an={A.label} bn={B.label} />}

          <div className="grid g2h">
            {(["a", "b"] as Side[]).map((s) => {
              const f = d.focus![s], im = improve(s), ac = actions(s);
              return (
                <Sec key={s} title={`Where ${nameOf(s)} can improve`}>
                  {!im.length ? <p className="small muted">Not behind on any scored metric in this period.</p> :
                    <ul className="cmp-list">{im.map((x) => <li key={x.m.key}><b>{x.m.label}</b>: <N ids={x.ids} title={`${x.m.label} · ${nameOf(s)}`}>{fmt(x.m, x.mine)}</N> vs {fmt(x.m, x.theirs)} <span className="muted">(behind by {gapOf(x.m)})</span></li>)}</ul>}
                  {f.types.length > 0 && <>
                    <div className="small muted cmp-h">{d.kind === "reviewer" ? "Task types reviewed least on time" : "Task types done least on time"}</div>
                    <ul className="cmp-list">{f.types.map((t) => <li key={t.task}>{t.task}: <N ids={t.ids} title={`${t.task} · ${nameOf(s)}`}>{fmtP(t.onTime)}</N> on time <span className="muted">of {t.due}{t.missed ? `, ${t.missed} missed` : ""}</span></li>)}</ul>
                  </>}
                  {f.reasons.length > 0 && <>
                    <div className="small muted cmp-h">Most common send-back reasons</div>
                    <ul className="cmp-list">{f.reasons.map((r) => <li key={r.reason}>{r.reason}: <N ids={r.ids} title={`Sent back: ${r.reason} · ${nameOf(s)}`} /></li>)}</ul>
                  </>}
                  {ac.length > 0 && <>
                    <div className="small muted cmp-h">Recommended actions</div>
                    <ul className="cmp-list">{ac.map((x) => <li key={x}>{x}</li>)}</ul>
                  </>}
                </Sec>
              );
            })}
          </div>
          <p className="small muted" style={{ textAlign: "center" }}>Prototype with sample data. Figures are calculated from the task records in this demo.</p>
        </>}
      </div>
      {drill && !task && <DrillDrawer drill={drill} tasks={d.tasks} now={d.now} close={() => setDrill(null)} openTask={(id) => setTask({ id, fromList: true })} />}
      {task && <TaskDrawer id={task.id} now={d.now} canEscalate={d.canEscalate} onDone={setToast}
        back={task.fromList && drill ? () => setTask(null) : undefined} close={() => { setTask(null); setDrill(null); }} />}
      {report !== null && A && B && <CopyModal title="Comparison report" text={report} file={`compare-${A.label}-vs-${B.label}-${d.R.from}-to-${d.R.to}.md`.toLowerCase().replace(/[^\w.-]+/g, "-")} close={() => setReport(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </DrillCtx.Provider>
  );
}

function TrendAB({ days, a, b, label, an, bn }: { days: string[]; a: (number | null)[]; b: (number | null)[]; label: string; an: string; bn: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 170, L = 30, Bt = 18, n = days.length;
  const x = (i: number) => L + (n === 1 ? (W - L) / 2 : (i * (W - L - 8)) / (n - 1));
  const y = (v: number) => 6 + (1 - v / 100) * (H - Bt - 6);
  const segs = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).reduce<string[][]>((acc, p) => { if (p === null) acc.push([]); else acc[acc.length - 1].push(p); return acc; }, [[]]).filter((s) => s.length);
  const short = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const avg = (vs: (number | null)[]) => { const l = vs.filter((v): v is number => v !== null); return l.length ? Math.round(l.reduce((p, q) => p + q, 0) / l.length) : null; };
  return (
    <Sec title={`${label}, day by day`} tip={<InfoTip title={`${label}, day by day`} rows={[["Line", "Share for each day in the period"], ["Gaps", "Days with no tasks are left blank"]]} />}
      right={<span className="row2 small"><span><span className="cmp-dot a" />{an} <b>{fmtP(avg(a))}</b> avg</span><span><span className="cmp-dot b" />{bn} <b>{fmtP(avg(b))}</b> avg</span></span>}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", minHeight: 110 }} role="img" aria-label={`${label} trend for ${an} and ${bn}`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W} y1={y(100 * f)} y2={y(100 * f)} stroke="var(--line2)" /><text x={L - 4} y={y(100 * f) + 3} textAnchor="end" fontSize="9" fill="var(--faint)">{100 * f}%</text></g>)}
        {segs(b).map((s, i) => <polyline key={`b${i}`} points={s.join(" ")} fill="none" stroke="var(--cmp-b)" strokeWidth="2" />)}
        {segs(a).map((s, i) => <polyline key={`a${i}`} points={s.join(" ")} fill="none" stroke="var(--cmp-a)" strokeWidth="2" />)}
        {days.map((_, i) => <rect key={i} x={x(i) - (W - L) / n / 2} y={0} width={(W - L) / n} height={H - Bt} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={6} y2={H - Bt} stroke="var(--faint)" strokeDasharray="3 3" />}
        {[0, n - 1].filter((v, i, arr) => arr.indexOf(v) === i).map((i) => <text key={i} x={x(i)} y={H - 4} fontSize="9" textAnchor={i === 0 ? "start" : "end"} fill="var(--faint)">{short(days[i])}</text>)}
      </svg>
      <div className="small muted chart-tip">{hover !== null ? <>{short(days[hover])}: {an} <b style={{ color: "var(--fg)" }}>{fmtP(a[hover])}</b> · {bn} <b style={{ color: "var(--fg)" }}>{fmtP(b[hover])}</b></> : "Hover the chart for each day's values."}</div>
    </Sec>
  );
}
