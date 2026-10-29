"use client";
// Operations command center. Order follows the questions ops asks: how are we doing, what needs action now,
// why is it happening, and who is accountable. Every number opens the tasks behind it in a side drawer.
import { useEffect, useMemo, useState } from "react";
import type { CC, Issue } from "@/lib/command";
import DashFilters from "@/components/DashFilters";
import { DrillCtx, Drill, InfoTip, Mini, Tile, dur, Delta, useDrill } from "./parts";
import { DrillDrawer, TaskDrawer } from "./Drawers";
import ActionQueue from "./ActionQueue";
import { Compare, Lifecycle, Reasons, Recurring, Trends } from "./Insights";
import { Cbms, Housekeeping, Properties, Reviewers } from "./Accountability";

const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const span = (r: { from: string; to: string }) => (r.from === r.to ? nice(r.from) : `${nice(r.from)} – ${nice(r.to)}`);

function Health({ d }: { d: CC }) {
  const g = d.ground, v = d.review, o = d.outcome;
  const { open } = useDrill();
  const parts: [string, typeof o.done, string][] = [["Approved and closed", o.done, "var(--green)"], ["In review or being fixed", o.inprog, "var(--blue)"],
    ["Not submitted yet", o.notsub, "var(--amber)"], ["Missed", o.missed, "var(--red)"], ["Not rectified", o.notrect, "var(--purple)"]];
  const due = g.due.n;
  return (
    <div className="grid g2h">
      <section className="card score">
        <h3>Ground team<InfoTip title="Ground team" rows={[["Due", "Tasks whose deadline has passed. Cancelled (waived) tasks are left out"], ["On time", "Submitted by the deadline ÷ due"], ["First-time approval", "Approved on the first check ÷ tasks checked at least once"], ["Missed", "Grace period ended with nothing submitted ÷ due"]]} note="Every figure counts tasks. Click any figure to see them." /></h3>
        <div className="kpis k3">
          <Tile label="On time" k={g.onTime} band={[85, 70]} target="Target 85%+" unitNote="Submitted by the deadline" />
          <Tile label="First-time approval" k={g.fta} band={[80, 65]} target="Target 80%+" unitNote="Approved on the first check" />
          <Tile label="Missed" k={g.missed} band={[5, 10]} goodUp={false} target="Target under 5%" unitNote="Never submitted" />
        </div>
        <div className="minis">
          <Mini label="Assigned" k={g.assigned} tip="All tasks in the period, excluding cancelled" />
          <Mini label="Due" k={g.due} tip="Deadline has passed" />
          <Mini label="Late" k={g.late} tone="a" tip="Submitted after the deadline" />
          <Mini label="Overdue, still open" k={g.overdue} tone="a" tip="Past the deadline, still inside the grace period" />
          <Mini label="Sent back" k={g.returned} tip="Sent back at least once" />
          <Mini label="Sent back 2+" k={g.repeat} tone="r" tip="Sent back two or more times" />
        </div>
      </section>
      <section className="card score">
        <h3>Reviewers<InfoTip title="Reviewers" rows={[["Within SLA", "Tasks whose every check met its time limit ÷ tasks reviewed in the period"], ["SLA", "Set per task type, usually 24h from submission"], ["Wait", "Each check, from submission to decision. P90: 9 in 10 were faster"], ["Pending", "Waiting for a check right now"]]} note="Task counts, except wait times which use each check." /></h3>
        <div className="kpis k3">
          <Tile label="Reviewed within SLA" k={v.inSla} band={[90, 75]} target="Target 90%+" unitNote="Every check met its limit" />
          <TimeTile label="Median wait" t={v.median} band={[12, 24]} />
          <TimeTile label="P90 wait" t={v.p90} band={[24, 48]} />
        </div>
        <div className="minis">
          <Mini label="Needing review" k={v.requiring} tip="Reviewed in the period or waiting now" />
          <Mini label="Reviewed" k={v.reviewed} tip="Tasks with at least one check in the period" />
          <Mini label="After SLA" k={v.afterSla} tone="a" tip="Reviewed, but a check was late" />
          <Mini label="Pending now" k={v.pending} tip="Waiting for a check" />
          <Mini label="Pending past SLA" k={v.over} tone="r" tip="Waiting longer than the limit" />
          <Mini label="Awaiting re-review" k={v.rereview} tip="Fixed and resubmitted, waiting for a check" />
        </div>
      </section>
      <section className="card outcome">
        <div className="row2">
          <h3 style={{ margin: 0, display: "flex", alignItems: "center" }}>Outcome of {due} tasks due<InfoTip title="Outcome" rows={[["Approved and closed", "Approved and audit done or skipped"], ["In review or being fixed", "Submitted, not finished yet"], ["Not rectified", "Attempts used up without a pass"], ["Approved at any attempt", "Includes tasks approved and now in audit. Recent tasks may still be in review, so this rises over the following days"]]} note={o.waived.n ? `${o.waived.n} cancelled tasks are not counted.` : undefined} /></h3>
          <span className="spacer" />
          <span className="small">Approved at any attempt <b>{o.approved.rate ?? "—"}%</b> <Delta cur={o.approved.rate} prev={o.approved.prev} /></span>
        </div>
        <div className="bar big" aria-label="Outcome of tasks due">{parts.map(([l, k, c]) => <i key={l} title={`${l}: ${k.n}`} style={{ width: `${due ? (k.n / due) * 100 : 0}%`, background: c }} />)}</div>
        <div className="legend">{parts.map(([l, k, c]) => (
          <button key={l} type="button" className="lg" disabled={!k.n} onClick={() => open({ title: l, ids: k.ids })}><b style={{ color: c }}>●</b> {l} <b>{k.n}</b> <span className="muted">{k.rate ?? 0}%</span></button>
        ))}</div>
      </section>
    </div>
  );
}

function TimeTile({ label, t, band }: { label: string; t: { ms: number | null; prev: number | null; ids: number[] }; band: [number, number] }) {
  const h = t.ms === null ? null : t.ms / 3600_000;
  const r = h === null ? "" : h <= band[0] ? "g" : h <= band[1] ? "a" : "r";
  return (
    <div className="kpi"><span className={`rag ${r}`} title={r === "g" ? "Healthy" : r === "a" ? "Watch" : r === "r" ? "Act now" : "No data"} />
      <div className="lab">{label}</div><div className="v">{dur(t.ms)}</div>
      <div className="foot"><Delta cur={h === null ? null : Math.round(h)} prev={t.prev === null ? null : Math.round(t.prev / 3600_000)} goodUp={false} unit="h" /><span className="tgt">Under {band[0]}h</span></div>
    </div>
  );
}

export default function CommandCenter({ data: d }: { data: CC }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [task, setTask] = useState<{ id: number; fromList: boolean } | null>(null);
  const [cbm, setCbm] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".tip-pop")) { if (task) setTask(null); else setDrill(null); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [task]);
  const ctx = useMemo(() => ({ tasks: d.tasks, open: (x: Drill) => { setDrill(x); setTask(null); }, task: (id: number) => setTask({ id, fromList: false }) }), [d.tasks]);
  const issueOf = (id: number) => d.issues.find((i) => i.id === id);
  const scope = [d.filters.prop || d.filters.cluster || d.filters.city || "All properties", d.filters.cat, d.mine ? "my portfolio" : ""].filter(Boolean).join(" · ");
  const pickCbm = (name: string) => { setCbm(name); document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" }); };
  const crit = d.issues.filter((i) => i.sev === "Critical").length;

  return (
    <DrillCtx.Provider value={ctx}>
      <div className="page cc">
        <div className="row2">
          <div>
            <h1>Operations command center</h1>
            <p className="muted" style={{ margin: "2px 0 0" }}>{span(d.R)} vs {span(d.P)} · {d.propCount} properties{d.mine ? " · my portfolio" : ""} · data as of {new Date(d.now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
          <span className="spacer" />
          {d.issues.length > 0 && <a href="#actions" className={`alertpill ${crit ? "r" : "a"}`}>{crit ? `${crit} critical · ` : ""}{d.issues.length} need action</a>}
        </div>
        <DashFilters geo={d.geo} cats={d.cats} init={{ range: d.preset, ...d.filters }} range={d.R} mine={d.role === "reviewer" ? d.mine : undefined} />

        <h2 className="band">1 · Health</h2>
        <Health d={d} />

        <h2 className="band">2 · Action required</h2>
        <ActionQueue issues={d.issues} now={d.now} me={d.userName} canEscalate={d.canEscalate} toast={setToast}
          onIssue={(i: Issue) => i.id && setTask({ id: i.id, fromList: false })}
          handover={{ closedToday: d.closedToday, tomorrow: d.tomorrow, tasks: d.tasks, period: span(d.R), scope }} />

        <h2 className="band">3 · Why it&apos;s happening</h2>
        <Trends d={d} />
        <div className="grid g2">
          <Lifecycle d={d} />
          <Reasons d={d} />
        </div>
        <div className="grid g2w">
          <Compare d={d} />
          <Recurring d={d} />
        </div>

        <h2 className="band">4 · Who&apos;s accountable</h2>
        <Properties d={d} cbm={cbm} setCbm={setCbm} issues={d.issues} />
        <Reviewers d={d} />
        <Cbms d={d} onPick={pickCbm} />
        <Housekeeping d={d} />
        <p className="small muted" style={{ textAlign: "center" }}>Prototype with sample data. Figures are calculated from the task records in this demo, and every number links to the tasks behind it.</p>
      </div>
      {drill && !task && <DrillDrawer drill={drill} tasks={d.tasks} now={d.now} close={() => setDrill(null)} openTask={(id) => setTask({ id, fromList: true })} />}
      {task && <TaskDrawer id={task.id} now={d.now} canEscalate={d.canEscalate} issue={issueOf(task.id)} onDone={setToast}
        back={task.fromList && drill ? () => setTask(null) : undefined} close={() => { setTask(null); setDrill(null); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </DrillCtx.Provider>
  );
}
