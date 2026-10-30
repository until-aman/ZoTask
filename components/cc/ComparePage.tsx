"use client";
// Any number of stakeholders of one kind side by side: the same task-level metrics as the dashboard, a ranking, and a written report.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompareData, Kind, Metric } from "@/lib/compare";
import { CopyModal, DrillCtx, Drill, InfoTip, N, Sec, dur, fmtP } from "./parts";
import { DrillDrawer, TaskDrawer } from "./Drawers";
import { ActiveChip, DateRow, Field, FilterBar, SearchPick, SavedView, SortHead, SortState, Stats, sameFilters, sortRows } from "@/components/ui/Filters";

const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const span = (r: { from: string; to: string }) => (r.from === r.to ? nice(r.from) : `${nice(r.from)} – ${nice(r.to)}`);
const PRESETS: [string, string][] = [["today", "Today"], ["yday", "Yesterday"], ["7d", "Last 7 days"], ["14d", "Last 14 days"], ["30d", "Last 30 days"], ["custom", "Custom"]];
const COLORS = ["#2563eb", "#d97706", "#059669", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#65a30d"];
const fmt = (m: Metric, v: number | null) => (m.fmt === "pct" ? fmtP(v === null ? null : Math.round(v * 10) / 10) : m.fmt === "dur" ? dur(v) : v === null ? "—" : String(Math.round(v * 10) / 10));
const diff = (m: Metric, x: number, y: number) => (m.fmt === "pct" ? `${Math.abs(Math.round((x - y) * 10) / 10)} pts` : m.fmt === "dur" ? dur(Math.abs(x - y)) : String(Math.round(Math.abs(x - y) * 10) / 10));
const avg = (l: (number | null)[]) => { const v = l.filter((x): x is number => x !== null); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
const MIN_TASKS = 10;
const lc = (s: string) => (s.startsWith("CBM") ? s : s.toLowerCase());

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

/** Per metric: each entity's position (1 = best, ties share), the best and worst position, and the group average. */
function standings(m: Metric) {
  const v = m.vals.map((x) => x.v);
  const have = v.filter((x): x is number => x !== null);
  if (!m.better || have.length < 2) return null;
  const sign = m.better === "high" ? -1 : 1;
  const rank = v.map((x) => (x === null ? null : 1 + have.filter((y) => sign * y < sign * x).length));
  const ranks = rank.filter((r): r is number => r !== null);
  const top = Math.min(...ranks), bottom = Math.max(...ranks);
  return { rank, top, bottom, mean: avg(v)!, best: sign < 0 ? Math.max(...have) : Math.min(...have), split: top !== bottom };
}
type St = NonNullable<ReturnType<typeof standings>>;
const better = (m: Metric, x: number, y: number) => (m.better === "high" ? x > y : x < y);

export default function ComparePage({ data: d, views, bare }: { data: CompareData; views: SavedView[]; bare: boolean }) {
  const router = useRouter();
  const [drill, setDrill] = useState<Drill | null>(null);
  const [task, setTask] = useState<{ id: number; fromList: boolean } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".tip-pop")) { if (task) setTask(null); else setDrill(null); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [task]);
  const ctx = useMemo(() => ({ tasks: d.tasks, open: (x: Drill) => { setDrill(x); setTask(null); }, task: (id: number) => setTask({ id, fromList: false }) }), [d.tasks]);

  const P = d.picked, ids = P.map((o) => o.id);
  const go = (patch: { kind?: Kind; ids?: string[]; range?: string; from?: string; to?: string } = {}) => {
    const range = patch.range ?? d.preset;
    const v: Record<string, string> = { kind: patch.kind ?? d.kind, range, ...(range === "custom" ? { from: patch.from ?? d.R.from, to: patch.to ?? d.R.to } : {}) };
    if (!patch.kind || patch.kind === d.kind) v.ids = (patch.ids ?? ids).join(",") || "-";
    router.push(`/compare?${new URLSearchParams(Object.entries(v).filter(([, x]) => x))}`);
  };
  const current: Record<string, string> = { kind: d.kind, ids: ids.join(","), range: d.preset, ...(d.preset === "custom" ? { from: d.R.from, to: d.R.to } : {}) };
  const def = views.find((v) => v.def);
  useEffect(() => { if (bare && def && !sameFilters(def.f, current)) router.push(`/compare?${new URLSearchParams(def.f as Record<string, string>)}`); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const kindLabel = d.kinds.find(([k]) => k === d.kind)?.[1] ?? "";
  const one = kindLabel.replace(/ies$/, "y").replace(/s$/, "");
  const ready = P.length >= 2 && d.metrics.length > 0;

  // Standings per metric, then an overall ranking by average position across scored metrics.
  const st = useMemo(() => d.metrics.map((m) => standings(m)), [d.metrics]);
  const volKey = d.kind === "reviewer" ? "reviewed" : "due";
  const vol = d.metrics.find((m) => m.key === volKey);
  const ranking = useMemo(() => P.map((o, i) => {
    let sum = 0, n = 0, bestOn = 0, worstOn = 0;
    d.metrics.forEach((m, k) => { const s = st[k]; const r = s?.rank[i]; if (!s || r == null) return; sum += r; n++; if (s.split && r === s.top) bestOn++; if (s.split && r === s.bottom) worstOn++; });
    return { o, i, avgPos: n ? sum / n : null, bestOn, worstOn, scored: n, tasks: vol?.vals[i].v ?? 0 };
  }).sort((x, y) => (x.avgPos ?? 99) - (y.avgPos ?? 99) || y.bestOn - x.bestOn), [P, d.metrics, st, vol]);
  const place = new Map<number, number>();
  ranking.forEach((r, k) => place.set(r.i, k > 0 && r.avgPos === ranking[k - 1].avgPos ? place.get(ranking[k - 1].i)! : k + 1));

  /** Metrics where entity i is ahead of / behind the group average, with the leader for context. */
  const split = (i: number) => {
    const ahead: { m: Metric; s: St; v: number }[] = [], behind: { m: Metric; s: St; v: number; ids: number[] }[] = [];
    d.metrics.forEach((m, k) => {
      const s = st[k], v = m.vals[i].v; if (!s || v === null || !s.split) return;
      if (better(m, v, s.mean)) ahead.push({ m, s, v }); else if (better(m, s.mean, v)) behind.push({ m, s, v, ids: m.vals[i].ids });
    });
    return { ahead, behind };
  };
  const leaderOf = (s: St) => P.filter((_, i) => s.rank[i] === s.top).map((o) => o.label).join(", ");
  const actions = (i: number) => [...new Set(split(i).behind.map((x) => ACTION[x.m.key]).filter(Boolean))].slice(0, 4);

  const buildReport = () => {
    const L: string[] = [];
    const ofTxt = (m: Metric, i: number) => { const x = m.vals[i]; return m.fmt === "pct" && x.of !== undefined ? ` (${x.ids.length} of ${x.of})` : ""; };
    L.push(`# ${one} comparison: ${P.map((o) => o.label).join(", ")}`, "");
    L.push(`Period: ${span(d.R)} (${d.R.days} days)`, `Generated: ${new Date(d.now).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      "Counted per task: each task is counted once however many checks or reviews it had.", "");
    L.push("## Ranking", "", "Ranked by average position across the scored metrics (1.0 = best on every metric).", "", `| # | ${one} | Average position | Best on | Worst on | Tasks |`, "|---|---|---|---|---|---|");
    for (const r of ranking) L.push(`| ${place.get(r.i)} | ${r.o.label} | ${r.avgPos === null ? "—" : r.avgPos.toFixed(1)} | ${r.bestOn} | ${r.worstOn} | ${r.tasks}${r.tasks < MIN_TASKS ? " (few tasks, read with care)" : ""} |`);
    L.push("", `Top performer: ${ranking[0].o.label}. Needs the most support: ${ranking[ranking.length - 1].o.label}.`, "");
    L.push("## Metrics", "", `| Metric | ${P.map((o) => o.label).join(" | ")} | Best |`, `|---|${P.map(() => "---").join("|")}|---|`);
    d.metrics.forEach((m, k) => { const s = st[k]; L.push(`| ${m.label} | ${m.vals.map((x, i) => `${fmt(m, x.v)}${ofTxt(m, i)}`).join(" | ")} | ${s?.split ? leaderOf(s) : s ? "Same" : "Not scored"} |`); });
    L.push("");
    for (const r of ranking) {
      const i = r.i, o = r.o, f = d.focus[i], { ahead, behind } = split(i);
      L.push(`## ${place.get(i)}. ${o.label}${o.sub ? ` (${o.sub})` : ""}`, "");
      L.push("Doing well (better than the group average):");
      if (!ahead.length) L.push("- Not above the group average on any metric in this period.");
      for (const x of ahead) L.push(`- ${x.m.label}: ${fmt(x.m, x.v)} vs average ${fmt(x.m, x.s.mean)}${x.s.rank[i] === x.s.top ? " (best in group)" : ""}`);
      L.push("", "Needs improvement (worse than the group average):");
      if (!behind.length) L.push("- Not below the group average on any metric in this period.");
      for (const x of behind) L.push(`- ${x.m.label}: ${fmt(x.m, x.v)} vs average ${fmt(x.m, x.s.mean)} and best ${fmt(x.m, x.s.best)} (${leaderOf(x.s)}), ${diff(x.m, x.v, x.s.best)} behind the best`);
      if (f.types.length) { L.push("", d.kind === "reviewer" ? "Task types reviewed least on time:" : "Task types done least on time:"); for (const t of f.types) L.push(`- ${t.task}: ${fmtP(t.onTime)} on time of ${t.due}${t.missed ? `, ${t.missed} missed` : ""}`); }
      if (f.reasons.length) { L.push("", "Most common send-back reasons:"); for (const x of f.reasons) L.push(`- ${x.reason}: ${x.ids.length} ${x.ids.length === 1 ? "task" : "tasks"}`); }
      const ac = actions(i);
      if (ac.length) { L.push("", "Recommended actions:"); for (const x of ac) L.push(`- ${x}`); }
      L.push("");
    }
    L.push("---", "Volume metrics and those with no right direction (sent back %, re-reviewed) are shown for context and not scored.");
    return L.join("\n");
  };

  const unpicked = d.options.filter((o) => !ids.includes(o.id));
  const spreadOf = (m: Metric) => { const vs = m.vals.map((x) => x.v).filter((x): x is number => x !== null); return vs.length > 1 ? Math.max(...vs) - Math.min(...vs) : null; };
  const rowsM = sortRows(d.metrics.map((m, k) => ({ m, k })), sort, (r, key) => key === "metric" ? r.m.label : key === "spread" ? spreadOf(r.m) : r.m.vals[Number(key.slice(1))]?.v ?? null);
  return (
    <DrillCtx.Provider value={ctx}>
      <div className="page cc">
        <div className="row2">
          <div>
            <h1>Compare</h1>
            <p className="muted" style={{ margin: "2px 0 0" }}>Put {lc(kindLabel)} side by side for {span(d.R)}. Pick 2 to {d.max}. Every number opens the tasks behind it.</p>
          </div>
          <span className="spacer" />
          {ready && <button type="button" className="btn primary" onClick={() => setReport(buildReport())}>Generate report</button>}
        </div>

        {ready && <Stats items={ranking.map((r) => ({
          key: r.o.id, label: r.o.label,
          value: `#${place.get(r.i)}`,
          sub: <>avg position {r.avgPos === null ? "—" : <b>{r.avgPos.toFixed(1)}</b>} · best on <b className="t-g">{r.bestOn}</b>, worst on <b className={r.worstOn ? "t-r" : ""}>{r.worstOn}</b> of {r.scored}{r.tasks < MIN_TASKS ? <span className="t-a"> · few tasks</span> : null}</>,
          tone: place.get(r.i) === 1 ? "g" as const : place.get(r.i) === ranking.length ? "r" as const : undefined,
          tip: <InfoTip title="Overall ranking" rows={[["Rank", "Place by average position across the scored metrics"], ["Avg position", "1.0 means best on every metric"], ["Best on / worst on", "Metrics where it is first or last in this group"], ["Tasks", `${r.tasks} ${d.kind === "reviewer" ? "reviewed" : "due"} in the period`]]} />,
        }))} />}

        <FilterBar
          chips={[
            ...P.map((o, i): ActiveChip => ({ key: o.id, label: <><span className="cmp-dot" style={{ background: COLORS[i] }} aria-hidden="true" />{o.label}</>, clear: () => go({ ids: ids.filter((x) => x !== o.id) }) })),
          ]}
          onClearAll={() => go({ ids: [] })}
          saved={{ page: "compare", views, current, notify: setToast, name: `${kindLabel}: ${P.map((o) => o.label).join(", ")}`.slice(0, 60),
            apply: (f) => router.push(`/compare?${new URLSearchParams(f as Record<string, string>)}`), note: "Saves who is compared and the date range." }}
          dates={<DateRow presets={PRESETS} value={d.preset} from={d.R.from} to={d.R.to} onPick={(k) => go({ range: k })} onCustom={(f, t) => go({ range: "custom", from: f, to: t })} />}
          panel={<>
            <Field label="Compare" wide><div className="seg" role="group" aria-label="What to compare">
              {d.kinds.map(([k, l]) => <button key={k} type="button" aria-pressed={d.kind === k} onClick={() => go({ kind: k })}>{l}</button>)}
            </div></Field>
            <Field label={`${kindLabel} (2 to ${d.max})`} wide>
              <div className="row2 cmp-picks">
                {P.map((o, i) => (
                  <span key={o.id} className="cmp-chip" style={{ borderColor: COLORS[i] }}>
                    <span className="cmp-dot" style={{ background: COLORS[i] }} aria-hidden="true" />{o.label}
                    <button type="button" aria-label={`Remove ${o.label}`} onClick={() => go({ ids: ids.filter((x) => x !== o.id) })}>×</button>
                  </span>
                ))}
                {P.length < d.max && unpicked.length > 0 && (
                  <span style={{ flex: "1 1 220px", maxWidth: 320 }}><SearchPick multi id="cmp-add" onChange={(v) => go({ ids: [...ids, v] })} placeholder={`+ Add ${lc(one)} (type to search)`}
                    options={unpicked.map((o) => ({ v: o.id, label: o.label, sub: o.sub }))} /></span>
                )}
                {P.length < Math.min(d.max, d.options.length) && <button type="button" className="link small" onClick={() => go({ ids: [...ids, ...unpicked.map((o) => o.id)].slice(0, d.max) })}>Add all{d.options.length > d.max ? ` (up to ${d.max})` : ""}</button>}
              </div>
            </Field>
          </>} />

        {!ready ? <div className="card empty"><b>Pick at least two</b>{d.options.length < 2 ? `You need at least two ${lc(kindLabel)} you can see.` : `Add ${lc(kindLabel)} above to compare them.`}</div> : <>
          <Sec title="Side by side" tip={<InfoTip title="Side by side" rows={[["Counted", "Per task. A task counts once however many checks or reviews it had"], ["Green / red", "Best and worst in this group. Not scored means there is no right direction"], ["Spread", "Gap between the best and the worst"], ["Click", "Any number to see its tasks"]]} />}>
            <div className="tbl"><table className="cmp-tbl">
              <thead><tr><th><SortHead k="metric" label="Metric" sort={sort} setSort={setSort} /></th>{P.map((o, i) => <th key={o.id} className="n"><span className="cmp-dot" style={{ background: COLORS[i] }} /><SortHead k={`v${i}`} label={o.label} sort={sort} setSort={setSort} /></th>)}<th>Best</th><th className="n"><SortHead k="spread" label="Spread" sort={sort} setSort={setSort} /></th></tr></thead>
              <tbody>{rowsM.map(({ m, k }) => {
                const s = st[k];
                const vs = m.vals.map((x) => x.v).filter((x): x is number => x !== null);
                return (
                  <tr key={m.key}>
                    <td><span className="row2" style={{ gap: 4, flexWrap: "nowrap" }}>{m.label}<InfoTip title={m.label} rows={[["Means", m.means], ["Better", m.better === "high" ? "Higher" : m.better === "low" ? "Lower" : "Not scored"]]} /></span></td>
                    {m.vals.map((x, i) => {
                      const r = s?.rank[i], who = P[i].label;
                      const cls = s?.split && r === s.top ? "cmp-win" : s?.split && r === s.bottom ? "cmp-lose" : "";
                      return <td key={i} className={`n ${cls}`}>
                        {m.fmt === "n" ? <N ids={x.ids} title={`${m.label} · ${who}`} note={m.means} />
                          : <N ids={x.ids} title={`${m.label} · ${who}`} note={m.fmt === "dur" ? "Tasks this time is based on" : m.means}>{fmt(m, x.v)}</N>}
                        {m.fmt === "pct" && x.of !== undefined && <span className="small muted"> {x.ids.length}/{x.of}</span>}
                      </td>;
                    })}
                    <td>{!s ? <span className="muted small">Not scored</span> : !s.split ? <span className="muted small">Same</span> : <span className="small"><b>{leaderOf(s)}</b></span>}</td>
                    <td className="n small muted">{s?.split && vs.length > 1 ? diff(m, Math.max(...vs), Math.min(...vs)) : ""}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Sec>

          {d.series && <TrendN days={d.series.days} lines={d.series.lines} label={d.series.label} names={P.map((o) => o.label)} />}

          <div className="cmp-cards">
            {ranking.map(({ o, i }) => {
              const f = d.focus[i], { behind } = split(i), ac = actions(i);
              return (
                <Sec key={o.id} title={`#${place.get(i)} ${o.label}: where to improve`}>
                  <span className="cmp-bar" style={{ background: COLORS[i] }} aria-hidden="true" />
                  {!behind.length ? <p className="small muted">Not below the group average on any scored metric in this period.</p> :
                    <ul className="cmp-list">{behind.map((x) => <li key={x.m.key}><b>{x.m.label}</b>: <N ids={x.ids} title={`${x.m.label} · ${o.label}`}>{fmt(x.m, x.v)}</N> <span className="muted">vs average {fmt(x.m, x.s.mean)}, best {fmt(x.m, x.s.best)}</span></li>)}</ul>}
                  {f.types.length > 0 && <>
                    <div className="small muted cmp-h">{d.kind === "reviewer" ? "Task types reviewed least on time" : "Task types done least on time"}</div>
                    <ul className="cmp-list">{f.types.map((t) => <li key={t.task}>{t.task}: <N ids={t.ids} title={`${t.task} · ${o.label}`}>{fmtP(t.onTime)}</N> on time <span className="muted">of {t.due}{t.missed ? `, ${t.missed} missed` : ""}</span></li>)}</ul>
                  </>}
                  {f.reasons.length > 0 && <>
                    <div className="small muted cmp-h">Most common send-back reasons</div>
                    <ul className="cmp-list">{f.reasons.map((x) => <li key={x.reason}>{x.reason}: <N ids={x.ids} title={`Sent back: ${x.reason} · ${o.label}`} /></li>)}</ul>
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
      {report !== null && <CopyModal title="Comparison report" text={report} file={`compare-${d.kind}-${d.R.from}-to-${d.R.to}.md`} close={() => setReport(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </DrillCtx.Provider>
  );
}

function TrendN({ days, lines, label, names }: { days: string[]; lines: (number | null)[][]; label: string; names: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [only, setOnly] = useState<number | null>(null);
  const W = 1000, H = 170, L = 30, Bt = 18, n = days.length;
  const x = (i: number) => L + (n === 1 ? (W - L) / 2 : (i * (W - L - 8)) / (n - 1));
  const y = (v: number) => 6 + (1 - v / 100) * (H - Bt - 6);
  const segs = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).reduce<string[][]>((acc, p) => { if (p === null) acc.push([]); else acc[acc.length - 1].push(p); return acc; }, [[]]).filter((s) => s.length);
  const short = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const mean = (vs: (number | null)[]) => { const v = avg(vs); return v === null ? null : Math.round(v); };
  return (
    <Sec title={`${label}, day by day`} tip={<InfoTip title={`${label}, day by day`} rows={[["Line", "Share for each day in the period"], ["Gaps", "Days with no tasks are left blank"], ["Legend", "Click a name to show only that line"]]} />}>
      <div className="row2 small">{names.map((nm, i) => (
        <button key={nm} type="button" className="lg" aria-pressed={only === i} style={{ opacity: only === null || only === i ? 1 : 0.45 }} onClick={() => setOnly(only === i ? null : i)}>
          <span className="cmp-dot" style={{ background: COLORS[i] }} />{nm} <b>{fmtP(mean(lines[i]))}</b> <span className="muted">avg</span>
        </button>
      ))}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", minHeight: 110 }} role="img" aria-label={`${label} trend`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W} y1={y(100 * f)} y2={y(100 * f)} stroke="var(--line2)" /><text x={L - 4} y={y(100 * f) + 3} textAnchor="end" fontSize="9" fill="var(--faint)">{100 * f}%</text></g>)}
        {lines.map((l, k) => (only === null || only === k) && segs(l).map((s, j) => <polyline key={`${k}-${j}`} points={s.join(" ")} fill="none" stroke={COLORS[k]} strokeWidth="2" opacity={only === null ? 0.85 : 1} />))}
        {days.map((_, i) => <rect key={i} x={x(i) - (W - L) / n / 2} y={0} width={(W - L) / n} height={H - Bt} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={6} y2={H - Bt} stroke="var(--faint)" strokeDasharray="3 3" />}
        {[0, n - 1].filter((v, i, arr) => arr.indexOf(v) === i).map((i) => <text key={i} x={x(i)} y={H - 4} fontSize="9" textAnchor={i === 0 ? "start" : "end"} fill="var(--faint)">{short(days[i])}</text>)}
      </svg>
      <div className="small muted chart-tip">{hover !== null ? <>{short(days[hover])}: {names.map((nm, i) => <span key={nm}>{i ? " · " : ""}{nm} <b style={{ color: "var(--fg)" }}>{fmtP(lines[i][hover])}</b></span>)}</> : "Hover the chart for each day's values."}</div>
    </Sec>
  );
}
