"use client";
// Who is accountable: properties (with an adjustable risk score), reviewers, CBMs and housekeeping headcount.
import { useState } from "react";
import type { CC, Issue } from "@/lib/command";
import { InfoTip, N, Sec, Spark, Table, dur, fmtP, rag } from "./parts";
import { Field, FilterBar } from "@/components/ui/Filters";

type Prop = CC["properties"][number];
const W0 = { late: 30, missed: 25, repeat: 15, sla: 15, critical: 15 };
const WL: Record<keyof typeof W0, string> = { late: "Not on time", missed: "Missed", repeat: "Sent back 2+", sla: "Reviews past SLA", critical: "Open critical issues" };
const riskOf = (p: Prop, w: typeof W0) => {
  if (!p.risk) return null;
  const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Math.round((Object.keys(w) as (keyof typeof W0)[]).reduce((s, k) => s + w[k] * p.risk![k], 0) / tot * 100);
};
const level = (v: number | null) => (v === null ? "" : v >= 40 ? "High" : v >= 20 ? "Medium" : "Low");
const LV: Record<string, string> = { High: "r", Medium: "a", Low: "g", "": "" };

export function Properties({ d, cbm, setCbm, issues }: { d: CC; cbm: string; setCbm: (v: string) => void; issues: Issue[] }) {
  const [w, setW] = useState(W0);
  const [editW, setEditW] = useState(false);
  const [lvl, setLvl] = useState("");
  const rowsP = d.properties.filter((p) => (!cbm || p.cbm === cbm) && (!lvl || level(riskOf(p, w)) === lvl));
  const delta = (p: Prop) => (p.onTime === null || p.onTimePrev === null ? null : Math.round(p.onTime - p.onTimePrev));
  return (
    <Sec id="properties" title="Properties" tip={<InfoTip title="Properties" rows={[["Order", "Highest risk first. Click any header to sort"], ["Counts", "Click a number to see its tasks"], ["▸", "Opens the property's open issues"]]} />}>
      <Table<Prop> name="Properties" rows={rowsP} rowKey={(p) => p.id} search={(p) => `${p.name} ${p.city} ${p.cluster} ${p.cbm}`} initialSort={{ key: "risk", dir: -1 }}
        toolbar={<>
          <FilterBar chips={[...(lvl ? [{ key: "lvl", label: <>Risk: <b>{lvl}</b></>, clear: () => setLvl("") }] : []), ...(cbm ? [{ key: "cbm", label: <>CBM: <b>{cbm}</b></>, clear: () => setCbm("") }] : [])]}
            onClearAll={() => { setLvl(""); setCbm(""); }}
            panel={<>
              <Field label="Risk level"><select value={lvl} onChange={(e) => setLvl(e.target.value)}><option value="">All risk levels</option><option>High</option><option>Medium</option><option>Low</option></select></Field>
              <Field label="CBM"><select value={cbm} onChange={(e) => setCbm(e.target.value)}><option value="">All CBMs</option>{[...new Set(d.properties.map((p) => p.cbm).filter(Boolean))].sort().map((c) => <option key={c}>{c}</option>)}</select></Field>
            </>} />
          <span className="pickwrap">
            <button type="button" className="btn sm" onClick={() => setEditW(!editW)} aria-expanded={editW}>Risk weights</button>
            {editW && <div className="pop" style={{ width: 280 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>Risk is 0 to 100. Each input is a share of tasks (0 to 1), weighted below. Needs 3+ tasks past deadline.</div>
              {(Object.keys(W0) as (keyof typeof W0)[]).map((k) => (
                <label key={k} className="opt" style={{ justifyContent: "space-between" }}>{WL[k]}
                  <input type="number" min={0} max={100} value={w[k]} style={{ width: 64 }} onChange={(e) => setW({ ...w, [k]: Math.max(0, Number(e.target.value) || 0) })} aria-label={`${WL[k]} weight`} /></label>
              ))}
              <div className="popfoot"><button type="button" className="link small" onClick={() => setW(W0)}>Reset</button><button type="button" className="btn sm primary" onClick={() => setEditW(false)}>Done</button></div>
            </div>}
          </span>
        </>}
        expand={(p) => {
          const mine = issues.filter((i) => i.pid === p.id);
          return mine.length ? <div className="grid" style={{ gap: 4 }}>{mine.slice(0, 8).map((i) => <div key={i.key} className="small"><span className={`pill ${i.sev === "Low" ? "" : i.sev === "Medium" ? "a" : "r"}`}>{i.sev}</span> {i.type} · {i.task} · <b>{i.owner}</b></div>)}{mine.length > 8 && <span className="small muted">…and {mine.length - 8} more in Action required</span>}</div>
            : <span className="small muted">No open issues at this property.</span>;
        }}
        cols={[
          { key: "name", label: "Property", sticky: true, value: (p) => p.name, render: (p) => <b>{p.name}</b> },
          { key: "geo", label: "City · Cluster", hidden: true, value: (p) => `${p.city} · ${p.cluster}`, render: (p) => <span className="muted">{p.city} · {p.cluster}</span> },
          { key: "cbm", label: "CBM", value: (p) => p.cbm },
          { key: "risk", label: "Risk", num: true, value: (p) => riskOf(p, w), csv: (p) => riskOf(p, w),
            tip: <InfoTip title="Risk score (indicative)" rows={(Object.keys(W0) as (keyof typeof W0)[]).map((k) => [WL[k], `weight ${w[k]}`] as [string, string])} note="A pointer for where to look first, not a verdict on the property. Change the weights with Risk weights." />,
            render: (p) => { const v = riskOf(p, w); return v === null ? <span className="small muted" title="Fewer than 3 tasks past deadline">Not enough data</span> : <span className={`pill ${LV[level(v)]}`}>{v} · {level(v)}</span>; } },
          { key: "due", label: "Deadline passed", num: true, value: (p) => p.due.length, render: (p) => <N ids={p.due} title={`${p.name}: tasks past deadline`} /> },
          { key: "onTime", label: "Done on time", num: true, tip: <InfoTip title="Done on time" rows={[["Means", "Tasks submitted by their deadline"], ["Formula", "On time ÷ tasks past deadline"]]} />, value: (p) => p.onTime, render: (p) => <span className={`pill ${rag(p.onTime, 85, 70)}`}>{fmtP(p.onTime)}</span> },
          { key: "d", label: "vs before", num: true, value: delta, render: (p) => { const x = delta(p); return x === null ? "—" : <span className={x >= 0 ? "t-g" : "t-r"}>{x > 0 ? "+" : ""}{x}</span>; } },
          { key: "fta", label: "Approved first time", num: true, tip: <InfoTip title="Approved first time" rows={[["Means", "Approved at the first review"], ["Formula", "Approved first time ÷ tasks reviewed"]]} />, value: (p) => p.fta, render: (p) => fmtP(p.fta) },
          { key: "approved", label: "Approved (any attempt)", num: true, tip: <InfoTip title="Approved (any attempt)" rows={[["Means", "Approved at any attempt"], ["Formula", "Approved ÷ tasks past deadline"]]} />, value: (p) => p.approved, render: (p) => fmtP(p.approved), hidden: true },
          { key: "overdue", label: "Overdue, not done", num: true, tip: <InfoTip title="Overdue, not done" rows={[["Means", "Past deadline, not submitted, grace period running"], ["Formula", "Count of tasks"]]} />, value: (p) => p.overdue.length, render: (p) => <N ids={p.overdue} title={`${p.name}: overdue, still open`} /> },
          { key: "missed", label: "Missed", num: true, value: (p) => p.missed.length, render: (p) => <N ids={p.missed} title={`${p.name}: missed`} className={p.missed.length ? "t-r" : ""} /> },
          { key: "pending", label: "Waiting for review", num: true, value: (p) => p.pending.length, render: (p) => <N ids={p.pending} title={`${p.name}: waiting for review`} /> },
          { key: "over", label: "Waiting too long", num: true, tip: <InfoTip title="Waiting too long" rows={[["Means", "Waiting for review longer than the limit"], ["Formula", "Count of tasks"]]} />, value: (p) => p.over.length, render: (p) => <N ids={p.over} title={`${p.name}: reviews past SLA`} className={p.over.length ? "t-r" : ""} /> },
          { key: "repeat", label: "Sent back 2+ times", num: true, value: (p) => p.repeat.length, render: (p) => <N ids={p.repeat} title={`${p.name}: sent back twice or more`} /> },
          { key: "trend", label: "Trend", value: () => null, render: (p) => <Spark data={p.spark} />, csv: (p) => p.spark.map((x) => x ?? "").join(" ") },
        ]} />
    </Sec>
  );
}

export function Reviewers({ d }: { d: CC }) {
  type R = CC["reviewers"][number];
  return (
    <Sec title="Reviewers" tip={<InfoTip title="Reviewers" rows={[["Counts", "Every column counts tasks, each task once"], ["Wait", "Per task, from submission to the reviewer's decision"], ["Send-back %", "Tasks sent back ÷ tasks reviewed"]]} note="A high send-back rate can mean a careful reviewer. Compare it with audit results before judging." />}>
      <Table<R> name="Reviewers" rows={d.reviewers} rowKey={(r) => r.name} search={(r) => r.name} cols={[
        { key: "name", label: "Reviewer", sticky: true, value: (r) => r.name, render: (r) => <b>{r.name}</b> },
        { key: "props", label: "Properties", num: true, value: (r) => r.props },
        { key: "req", label: "Reviewed + waiting", num: true, value: (r) => r.requiring.length, render: (r) => <N ids={r.requiring} title={`${r.name}: tasks needing review`} /> },
        { key: "rev", label: "Reviewed", num: true, value: (r) => r.reviewed.length, render: (r) => <N ids={r.reviewed} title={`${r.name}: tasks reviewed`} /> },
        { key: "sla", label: "Reviewed on time", num: true, tip: <InfoTip title="Reviewed on time" rows={[["Means", "Reviewed tasks where every review was on time"], ["Formula", "In-time tasks ÷ tasks reviewed"]]} />, value: (r) => r.inSla, render: (r) => <span className={`pill ${rag(r.inSla, 90, 75)}`}>{fmtP(r.inSla)}</span> },
        { key: "after", label: "Reviewed late", num: true, value: (r) => r.afterSla.length, render: (r) => <N ids={r.afterSla} title={`${r.name}: reviewed after SLA`} /> },
        { key: "pend", label: "Waiting for review", num: true, value: (r) => r.pending.length, render: (r) => <N ids={r.pending} title={`${r.name}: waiting now`} /> },
        { key: "over", label: "Waiting too long", num: true, value: (r) => r.over.length, render: (r) => <N ids={r.over} title={`${r.name}: pending past SLA`} className={r.over.length ? "t-r" : ""} /> },
        { key: "rmiss", label: "Missed reviews", num: true, tip: <InfoTip title="Missed reviews" rows={[["Means", "Tasks from this period submitted but not reviewed within the limit, still unreviewed"]]} />, value: (r) => r.missed.length, render: (r) => <N ids={r.missed} title={`${r.name}: missed reviews`} className={r.missed.length ? "t-r" : ""} /> },
        { key: "med", label: "Usual review wait", num: true, tip: <InfoTip title="Usual review wait" rows={[["Means", "Typical time a task waits for its review"], ["Formula", "Middle value across tasks reviewed"]]} />, value: (r) => r.median, render: (r) => dur(r.median), csv: (r) => (r.median === null ? "" : Math.round(r.median / 60000)) },
        { key: "re", label: "Re-reviewed", num: true, tip: <InfoTip title="Re-reviewed" rows={[["Means", "Tasks this reviewer reviewed more than once in the period"]]} />, value: (r) => r.reReviewed.length, render: (r) => <N ids={r.reReviewed} title={`${r.name}: tasks re-reviewed`} /> },
        { key: "sb", label: "Sent back %", num: true, tip: <InfoTip title="Sent back %" rows={[["Means", "Share of reviewed tasks sent back. High is not always bad"], ["Formula", "Tasks sent back ÷ tasks reviewed"]]} />, value: (r) => r.sentBackRate, render: (r) => <N ids={r.sentBack} title={`${r.name}: tasks sent back`}>{fmtP(r.sentBackRate)}</N> },
        { key: "daily", label: "Tasks reviewed per day", value: () => null, render: (r) => <Spark data={r.daily} max={Math.max(1, ...r.daily)} color="var(--purple)" />, csv: (r) => r.daily.join(" ") },
      ]} />
    </Sec>
  );
}

export function Cbms({ d, onPick }: { d: CC; onPick: (name: string) => void }) {
  type C = CC["cbms"][number];
  return (
    <Sec title="CBMs" tip={<InfoTip title="CBMs" rows={[["Owner", "Each property counts for one CBM, so rows add up to the total"], ["Open issues", "Tasks at their properties in Action required"], ["Fix time", "Median time from send-back to resubmission"], ["Name", "Click to filter Properties to that CBM"]]} />}>
      <Table<C> name="CBMs" rows={d.cbms} rowKey={(c) => c.name} search={(c) => c.name} cols={[
        { key: "name", label: "CBM", sticky: true, value: (c) => c.name, render: (c) => <button type="button" className="link" style={{ padding: 0 }} onClick={() => onPick(c.name)}>{c.name}</button> },
        { key: "props", label: "Properties", num: true, value: (c) => c.props },
        { key: "due", label: "Deadline passed", num: true, value: (c) => c.due.length, render: (c) => <N ids={c.due} title={`${c.name}: tasks past deadline`} /> },
        { key: "on", label: "Done on time", num: true, tip: <InfoTip title="Done on time" rows={[["Means", "Tasks submitted by their deadline"], ["Formula", "On time ÷ tasks past deadline"]]} />, value: (c) => c.onTime, render: (c) => <span className={`pill ${rag(c.onTime, 85, 70)}`}>{fmtP(c.onTime)}</span> },
        { key: "missed", label: "Missed", num: true, value: (c) => c.missed.length, render: (c) => <N ids={c.missed} title={`${c.name}: missed`} /> },
        { key: "fta", label: "Approved first time", num: true, tip: <InfoTip title="Approved first time" rows={[["Means", "Approved at the first review"], ["Formula", "Approved first time ÷ tasks reviewed"]]} />, value: (c) => c.fta, render: (c) => fmtP(c.fta) },
        { key: "rep", label: "Sent back 2+ times", num: true, value: (c) => c.repeat.length, render: (c) => <N ids={c.repeat} title={`${c.name}: repeated failures`} /> },
        { key: "iss", label: "Open issues", num: true, value: (c) => c.issues.length, render: (c) => <N ids={c.issues} title={`${c.name}: open issues`} /> },
        { key: "fix", label: "Usual fix time", num: true, tip: <InfoTip title="Usual fix time" rows={[["Means", "Typical time to fix and resubmit"], ["Formula", "Median from send-back to resubmission"]]} />, value: (c) => c.fix, render: (c) => dur(c.fix) },
        { key: "esc", label: "Escalated", num: true, value: (c) => c.escalated.length, render: (c) => <N ids={c.escalated} title={`${c.name}: escalated`} className={c.escalated.length ? "t-r" : ""} /> },
        { key: "trend", label: "On-time trend", value: () => null, render: (c) => <Spark data={c.spark} />, csv: (c) => c.spark.map((x) => x ?? "").join(" ") },
      ]} />
    </Sec>
  );
}

export function Housekeeping({ d }: { d: CC }) {
  const hk = d.staff.reduce((t, x) => ({ ihk: t.ihk + x.ideal_hk, chk: t.chk + x.current_hk, ishk: t.ishk + x.ideal_shk, cshk: t.cshk + x.current_shk }), { ihk: 0, chk: 0, ishk: 0, cshk: 0 });
  type S = CC["staff"][number];
  return (
    <Sec title="Housekeeping count" tip={<InfoTip title="Housekeeping count" rows={[["HK", "Housekeeper"], ["SHK", "Senior housekeeper (supervisor)"], ["Ideal", "How many the property should have"], ["Current", "How many are on the roster today"], ["To hire", "Ideal minus Current"]]} note="Sample numbers in this prototype." />}>
      <div className="hkwrap">
        <div className="hkgrid">
          {([["HK", hk.ihk, hk.chk], ["SHK", hk.ishk, hk.cshk]] as [string, number, number][]).map(([l, ideal, cur]) => {
            const gap = Math.max(0, ideal - cur);
            return <div key={l} className="kpi"><span className={`rag ${gap > 0 ? "r" : "g"}`} /><div className="kpi-h"><div className="v" style={{ color: gap > 0 ? "var(--red)" : "var(--green)" }}>{gap}</div><div className="lab">{l} to hire</div></div>
              <div className="sub">{cur} of {ideal} in place</div></div>;
          })}
        </div>
        <Table<S> name="Housekeeping" rows={d.staff} rowKey={(x) => x.property_id} initialSort={{ key: "hkGap", dir: -1 }} cols={[
          { key: "name", label: "Property", sticky: true, value: (x) => x.name },
          { key: "ihk", label: "Ideal HK", num: true, value: (x) => x.ideal_hk }, { key: "chk", label: "Current HK", num: true, value: (x) => x.current_hk },
          { key: "hkGap", label: "HK to hire", num: true, value: (x) => Math.max(0, x.ideal_hk - x.current_hk), render: (x) => { const g = Math.max(0, x.ideal_hk - x.current_hk); return <b className={g ? "t-r" : ""}>{g}</b>; } },
          { key: "ishk", label: "Ideal SHK", num: true, value: (x) => x.ideal_shk }, { key: "cshk", label: "Current SHK", num: true, value: (x) => x.current_shk },
          { key: "shkGap", label: "SHK to hire", num: true, value: (x) => Math.max(0, x.ideal_shk - x.current_shk), render: (x) => { const g = Math.max(0, x.ideal_shk - x.current_shk); return <b className={g ? "t-r" : ""}>{g}</b>; } },
        ]} />
      </div>
    </Sec>
  );
}
