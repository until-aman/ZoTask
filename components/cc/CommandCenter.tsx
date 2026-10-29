"use client";
// Operations command center. Order follows the questions ops asks: how are we doing, what needs action now,
// why is it happening, and who is accountable. Every number opens the tasks behind it in a side drawer.
import { useEffect, useMemo, useState } from "react";
import type { CC, Issue } from "@/lib/command";
import DashFilters from "@/components/DashFilters";
import { DrillCtx, Drill, Def, DefTip, Mini, Tile, dur, Delta, useDrill } from "./parts";
import { DrillDrawer, TaskDrawer } from "./Drawers";
import ActionQueue from "./ActionQueue";
import { Compare, Lifecycle, Reasons, Recurring, Trends } from "./Insights";
import { Cbms, Housekeeping, Properties, Reviewers } from "./Accountability";

const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const span = (r: { from: string; to: string }) => (r.from === r.to ? nice(r.from) : `${nice(r.from)} – ${nice(r.to)}`);

function Health({ d }: { d: CC }) {
  const g = d.ground, v = d.review, o = d.outcome;
  const { open } = useDrill();
  const parts: [string, typeof o.done, string, string][] = [["Approved and closed", o.done, "var(--green)", "Approved, and audit done or not needed"],
    ["In review or being fixed", o.inprog, "var(--blue)", "Submitted, still in review, audit or being corrected"],
    ["Not submitted yet", o.notsub, "var(--amber)", "Past the deadline, grace period still running"], ["Missed", o.missed, "var(--red)", "Grace period ended with nothing submitted"],
    ["Not rectified", o.notrect, "var(--purple)", "All attempts used without a pass"]];
  const due = g.due.n;
  return (
    <div className="grid g2h">
      <section className="card score">
        <h3>Ground team</h3>
        <div className="kpis k3">
          <Tile label="Done on time" def={{ means: "Tasks submitted by their deadline", calc: "Submitted on time ÷ tasks past deadline", note: "Cancelled tasks are left out." }} k={g.onTime} band={[85, 70]} target="Target 85%+" unitNote="Submitted by the deadline" />
          <Tile label="Approved first time" def={{ means: "Tasks approved at their first review", calc: "Approved first time ÷ tasks reviewed at least once", note: "Tasks still waiting for a first review are left out." }} k={g.fta} band={[80, 65]} target="Target 80%+" unitNote="Approved on the first review" />
          <Tile label="Missed" def={{ means: "Tasks never submitted, even in the grace period", calc: "Missed ÷ tasks past deadline", note: "Lower is better." }} k={g.missed} band={[5, 10]} goodUp={false} target="Target under 5%" unitNote="Never submitted" />
        </div>
        <div className="minis">
          <Mini label="Total tasks" k={g.assigned} def={{ means: "All tasks scheduled in the period", note: "Cancelled tasks are left out." }} />
          <Mini label="Deadline passed" k={g.due} def={{ means: "Tasks whose deadline is over, whether done or not. Not a to-do count", note: "This is the base for On time and Missed. Still to do: Overdue, not done." }} />
          <Mini label="Done late" k={g.late} tone="a" def={{ means: "Submitted, but after the deadline" }} />
          <Mini label="Overdue, not done" k={g.overdue} tone="a" def={{ means: "Past the deadline, not submitted, grace period still running", note: "These can still be saved today. Remind the owner." }} />
          <Mini label="Sent back for fixes" k={g.returned} def={{ means: "Tasks a reviewer sent back for changes at least once" }} />
          <Mini label="Sent back 2+ times" k={g.repeat} tone="r" def={{ means: "Tasks sent back two or more times", note: "A sign of a training or process problem." }} />
        </div>
      </section>
      <section className="card score">
        <h3>Reviewers</h3>
        <div className="kpis k3">
          <Tile label="Reviewed on time" def={{ means: "Reviewed tasks where every review was on time", calc: "In-time tasks ÷ tasks reviewed in the period", note: "SLA is set per task type, usually 24h from submission. Tasks still waiting are under Pending past SLA." }} k={v.inSla} band={[90, 75]} target="Target 90%+" unitNote="Every review was on time" />
          <TimeTile label="Usual review wait" t={v.median} band={[12, 24]} def={{ means: "Typical time a task waits for its review", calc: "Middle value, per task, of submission to the reviewer's decision", note: "Each task counted once." }} />
          <Tile label="Missed reviews" k={v.missed} band={[2, 5]} goodUp={false} target="Target under 2%" unitNote="Not reviewed within the time limit"
            def={{ means: "Submitted tasks not reviewed within the time limit, and still not reviewed", calc: "Missed reviews ÷ tasks submitted in the period", note: "Lower is better. Click to see the tasks." }} />
        </div>
        <div className="minis">
          <Mini label="Reviewed + waiting" k={v.requiring} def={{ means: "Tasks reviewed in the period plus tasks waiting now" }} />
          <Mini label="Reviewed" k={v.reviewed} def={{ means: "Tasks reviewed in the period", note: "Each task counted once, however many times it was reviewed." }} />
          <Mini label="Reviewed late" k={v.afterSla} tone="a" def={{ means: "Reviewed tasks that were reviewed late", note: "Late if any review on the task took longer than the limit." }} />
          <Mini label="Waiting for review" k={v.pending} def={{ means: "Submitted tasks waiting for review right now" }} />
          <Mini label="Waiting too long" k={v.over} tone="r" def={{ means: "Tasks waiting for review longer than the time limit", note: "These are in Action required." }} />
          <Mini label="Waiting for re-review" k={v.rereview} def={{ means: "Fixed and resubmitted, waiting for review" }} />
        </div>
      </section>
      <section className="card outcome">
        <div className="row2">
          <h3 style={{ margin: 0, display: "flex", alignItems: "center" }}>Outcome of {due} tasks past deadline</h3>
          <span className="spacer" />
          <span className="small" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Approved (any attempt) <b>{o.approved.rate ?? "—"}%</b>
            <DefTip label="Approved (any attempt)" def={{ means: "Tasks past deadline that passed review, first time or after fixing", calc: "Approved ÷ tasks past deadline", note: `Includes tasks now in audit. Recent tasks may still be in review, so this rises over the next days.${o.waived.n ? ` ${o.waived.n} cancelled tasks are not counted.` : ""}` }} k={o.approved} rate /> <Delta cur={o.approved.rate} prev={o.approved.prev} /></span>
        </div>
        <div className="bar big" aria-label="Outcome of tasks past deadline">{parts.map(([l, k, c]) => <i key={l} title={`${l}: ${k.n}`} style={{ width: `${due ? (k.n / due) * 100 : 0}%`, background: c }} />)}</div>
        <div className="legend">{parts.map(([l, k, c, m]) => (
          <span key={l} className="lgw"><button type="button" className="lg" disabled={!k.n} onClick={() => open({ title: l, ids: k.ids })}><b style={{ color: c }}>●</b> {l}: <b className="lgn">{k.n} ({k.rate ?? 0}%)</b></button>
            <DefTip label={l} def={{ means: m, calc: `${l} ÷ tasks past deadline` }} k={k} rate /></span>
        ))}</div>
      </section>
    </div>
  );
}

function TimeTile({ label, t, band, def }: { label: string; t: { ms: number | null; prev: number | null; ids: number[] }; band: [number, number]; def: Def }) {
  const h = t.ms === null ? null : t.ms / 3600_000;
  const r = h === null ? "" : h <= band[0] ? "g" : h <= band[1] ? "a" : "r";
  return (
    <div className="kpi"><span className={`rag ${r}`} title={r === "g" ? "Healthy" : r === "a" ? "Watch" : r === "r" ? "Act now" : "No data"} />
      <div className="lab">{label}<DefTip label={label} def={def} target={`Under ${band[0]}h`} /></div><div className="v">{dur(t.ms)}</div>
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
  const scope = [d.filters.prop || d.filters.cluster || d.filters.city || "All properties", d.filters.cat, d.filters.rv ? `reviewer ${d.reviewerOpts.find((r) => String(r.id) === d.filters.rv)?.name ?? ""}` : "", d.mine ? "my portfolio" : ""].filter(Boolean).join(" · ");
  const pickCbm = (name: string) => { setCbm(name); document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" }); };
  const crit = d.issues.filter((i) => i.sev === "Critical").length;

  return (
    <DrillCtx.Provider value={ctx}>
      <div className="page cc">
        <div className="row2">
          <div>
            <h1>Operations command center</h1>
            <p className="muted" style={{ margin: "2px 0 0" }}>{span(d.R)} vs {span(d.P)} · {d.propCount} properties{d.mine ? " · my portfolio" : ""}{d.filters.rv ? ` · reviewer: ${d.reviewerOpts.find((r) => String(r.id) === d.filters.rv)?.name ?? ""}` : ""} · data as of {new Date(d.now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
          <span className="spacer" />
          {d.issues.length > 0 && <a href="#actions" className={`alertpill ${crit ? "r" : "a"}`}>{crit ? `${crit} critical · ` : ""}{d.issues.length} need action</a>}
        </div>
        <DashFilters geo={d.geo} cats={d.cats} init={{ range: d.preset, ...d.filters }} range={d.R} mine={d.role === "reviewer" ? d.mine : undefined} reviewers={d.reviewerOpts} />

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
