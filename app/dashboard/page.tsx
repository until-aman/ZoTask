import Link from "next/link";
import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can, scopeProps } from "@/lib/auth";
import { geo, Row } from "@/lib/queries";
import * as M from "@/lib/metrics";
import { HOUR, fmtDate, isoDate } from "@/lib/time";
import RemindAll from "@/components/RemindAll";

type SP = Record<string, string | undefined>;
const PRESETS: [string, string][] = [["today", "Today"], ["yday", "Yesterday"], ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"]];

function Delta({ cur, prev, goodUp = true, unit = " pts" }: { cur: number | null; prev: number | null; goodUp?: boolean; unit?: string }) {
  if (cur === null || prev === null) return <span className="d flat">Nothing to compare with yet</span>;
  const d = Math.round((cur - prev) * 10) / 10;
  if (Math.abs(d) < 0.5) return <span className="d flat">→ Same as before</span>;
  const good = goodUp ? d > 0 : d < 0;
  return <span className={`d ${good ? "up" : "down"}`}>{good ? "▲ Better" : "▼ Worse"} than before by {Math.abs(d)}{unit === " pts" ? "%" : unit}</span>;
}
const rag = (v: number | null, g: number, a: number, lowerBetter = false) =>
  v === null ? "" : lowerBetter ? (v <= g ? "g" : v <= a ? "a" : "r") : v >= g ? "g" : v >= a ? "a" : "r";
const fmtP = (v: number | null) => (v === null ? "—" : `${v}%`);
const hrs = (ms: number | null) => (ms === null ? "—" : ms < 48 * HOUR ? `${Math.round(ms / HOUR)}h` : `${Math.round(ms / 864e5)}d`);

function Spark({ data }: { data: (number | null)[] }) {
  const pts = data.map((v, i) => (v === null ? null : [i * (80 / Math.max(1, data.length - 1)), 22 - (v / 100) * 20])).filter(Boolean) as number[][];
  if (pts.length < 2) return <span className="muted small">—</span>;
  return <svg className="spark" width="80" height="24" aria-hidden="true"><polyline fill="none" stroke="var(--blue)" strokeWidth="1.6" points={pts.map((p) => p.join(",")).join(" ")} /></svg>;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await boot();
  if (!can.dashboard(u)) redirect("/tasks");
  const sp = await searchParams;
  const now = Date.now(), today = isoDate(now);
  const preset = sp.range ?? "7d";
  const R = M.rangeFor(preset, today, sp.from, sp.to);
  const P = M.prevRange(R);
  const G = geo().filter((g) => scopeProps(u).includes(g.id));
  const props = G.filter((g) => (!sp.city || g.city === sp.city) && (!sp.cluster || g.cluster === sp.cluster) && (!sp.prop || g.property === sp.prop)).map((g) => g.id);

  const cur = M.load(props, R), prev = M.load(props, P), open = M.loadOpen(props);
  const E = M.execution(cur, now), Ep = M.execution(prev, now);
  const revs = M.reviewsIn(R, props), revsP = M.reviewsIn(P, props);
  const V = M.review(revs, open, now), Vp = M.review(revsP, [], now);
  const att = M.attention(open, cur, now, `from=${R.from}&to=${R.to}`);
  const reasons = M.reasons(R, props);
  const reopened = new Set(M.reopenAfterPass(R));

  const loc = [sp.city && `city=${encodeURIComponent(sp.city)}`, sp.cluster && `cluster=${encodeURIComponent(sp.cluster)}`, sp.prop && `prop=${encodeURIComponent(sp.prop)}`].filter(Boolean).join("&");
  const qhref = (tab: string, extra = "") => `/queue?tab=${tab}&from=${R.from}&to=${R.to}${loc ? "&" + loc : ""}${extra}`;
  const self = (patch: SP) => {
    const p = new URLSearchParams(Object.entries({ range: preset, city: sp.city, cluster: sp.cluster, prop: sp.prop, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/dashboard?${p}`;
  };

  // Ranked property table: worst on-time first.
  const byProp = new Map<number, Row[]>(), byPropPrev = new Map<number, Row[]>();
  for (const r of cur) byProp.set(r.property_id, [...(byProp.get(r.property_id) ?? []), r]);
  for (const r of prev) byPropPrev.set(r.property_id, [...(byPropPrev.get(r.property_id) ?? []), r]);
  const propRows = G.filter((g) => props.includes(g.id)).map((g) => {
    const l = byProp.get(g.id) ?? [];
    const e = M.execution(l, now), ep = M.execution(byPropPrev.get(g.id) ?? [], now);
    return { g, e, ep, pending: open.filter((r) => r.property_id === g.id && ["review", "resub"].includes(r.status)).length, spark: M.dailyOnTime(l, R, now), cbm: l[0]?.cbm ?? "" };
  }).sort((a, b) => (a.e.onTimeRate ?? 101) - (b.e.onTimeRate ?? 101));

  // One accountable CBM per property, so rows add up to the total.
  const cbms = [...new Set(propRows.map((p) => p.cbm).filter(Boolean))].map((name) => {
    const ps = propRows.filter((p) => p.cbm === name).map((p) => p.g.id);
    const e = M.execution(cur.filter((r) => ps.includes(r.property_id)), now);
    return { name, props: ps.length, e, flags: open.filter((r) => ps.includes(r.property_id) && r.status === "auditflag").length };
  }).sort((a, b) => (a.e.onTimeRate ?? 0) - (b.e.onTimeRate ?? 0));

  const reviewerNames = [...new Set([...revs.map((r) => r.reviewer), ...open.filter((r) => ["review", "resub"].includes(r.status)).map((r) => r.reviewer ?? "")])].filter(Boolean);
  const reviewers = reviewerNames.map((name) => {
    const mine = revs.filter((r) => r.reviewer === name);
    const v = M.review(mine, open.filter((r) => r.reviewer === name), now);
    const passed = new Set(mine.filter((r) => r.kind === "review" && r.decision === "pass").map((r) => r.instance_id));
    const audited = revs.filter((r) => r.kind === "audit" && passed.has(r.instance_id));
    return { name, v, reopen: [...passed].filter((id) => reopened.has(id)).length, audited: audited.length, disagree: audited.filter((a) => a.decision === "fail").length };
  }).filter((r) => r.v.decisions + r.v.pending > 0).sort((a, b) => (a.v.slaRate ?? 0) - (b.v.slaRate ?? 0));

  const cities = [...new Set(G.map((g) => g.city))];
  const clusters = [...new Set(G.filter((g) => !sp.city || g.city === sp.city).map((g) => g.cluster))];
  const propsOpts = G.filter((g) => (!sp.city || g.city === sp.city) && (!sp.cluster || g.cluster === sp.cluster));
  const recoverable = open.filter((r) => r.status === "notsub");
  const maxReason = Math.max(1, ...reasons.map((r) => r.n));

  return (
    <div className="page">
      <div className="row2">
        <div>
          <h1>Operations command center</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>{R.from === R.to ? fmtDate(R.from) : `${fmtDate(R.from)} – ${fmtDate(R.to)}`} vs {P.from === P.to ? fmtDate(P.from) : `${fmtDate(P.from)} – ${fmtDate(P.to)}`} · {props.length} properties · updated {new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <span className="spacer" />
        <div className="seg">{PRESETS.map(([k, l]) => <Link key={k} href={self({ range: k })} aria-pressed={preset === k}>{l}</Link>)}</div>
      </div>
      <form className="row2" action="/dashboard">
        <input type="hidden" name="range" value={preset} />
        <select name="city" defaultValue={sp.city ?? ""} aria-label="City"><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</select>
        <select name="cluster" defaultValue={sp.cluster ?? ""} aria-label="Cluster"><option value="">All clusters</option>{clusters.map((c) => <option key={c}>{c}</option>)}</select>
        <select name="prop" defaultValue={sp.prop ?? ""} aria-label="Property"><option value="">All properties</option>{propsOpts.map((p) => <option key={p.id}>{p.property}</option>)}</select>
        <button className="btn sm">Apply</button>
        {(sp.city || sp.cluster || sp.prop) && <Link className="link small" href={self({ city: undefined, cluster: undefined, prop: undefined })}>Clear</Link>}
      </form>

      <p className="small muted" style={{ margin: 0 }}>The dot on each number: <b style={{ color: "var(--green)" }}>● green</b> is good, <b style={{ color: "var(--amber)" }}>● amber</b> needs watching, <b style={{ color: "var(--red)" }}>● red</b> needs help now. “Before” means the same number of days just before these dates. Click any number to see the tasks behind it.</p>
      <div className="grid g3">
        <section className="card score">
          <div><h3>1 · Did the property team do their jobs?</h3><p className="small muted" style={{ margin: 0 }}>Looking at the {E.due} tasks whose deadline has already passed</p></div>
          <div className="kpis">
            <Link className="kpi" href={qhref("done")}><span className={`rag ${rag(E.onTimeRate, 85, 70)}`} />
              <div className="lab">Done on time</div><div className="v">{fmtP(E.onTimeRate)}</div><div className="sub">{E.onTime} of {E.due} tasks were finished before the deadline</div><Delta cur={E.onTimeRate} prev={Ep.onTimeRate} /></Link>
            <Link className="kpi" href={qhref("changes")}><span className={`rag ${rag(E.fpaRate, 80, 65)}`} />
              <div className="lab">Done right the first time</div><div className="v">{fmtP(E.fpaRate)}</div><div className="sub">{E.fpa} of {E.decided} checked tasks were approved without being sent back</div><Delta cur={E.fpaRate} prev={Ep.fpaRate} /></Link>
          </div>
          <div>
            <div className="bar" title="On time, late, still open, missed">
              {[[E.onTime, "var(--green)"], [E.late, "var(--amber)"], [E.open, "var(--blue)"], [E.missed, "var(--red)"]].map(([n, c], i) => <i key={i} style={{ width: `${E.due ? ((n as number) / E.due) * 100 : 0}%`, background: c as string }} />)}
            </div>
            <div className="row2 small" style={{ marginTop: 6, gap: 12 }}>
              <span><b style={{ color: "var(--green)" }}>●</b> On time {E.onTime}</span><span><b style={{ color: "var(--amber)" }}>●</b> Done late {E.late}</span>
              <Link href={qhref("notsub")}><b style={{ color: "var(--blue)" }}>●</b> Late, still possible {E.open}</Link><Link href={qhref("missed")}><b style={{ color: "var(--red)" }}>●</b> Never done {E.missed}</Link>
              {E.waived ? <Link href={qhref("waived")} className="muted">{E.waived} cancelled, not counted</Link> : null}
            </div>
          </div>
        </section>
        <section className="card score">
          <div><h3>2 · Did reviewers check the work quickly?</h3><p className="small muted" style={{ margin: 0 }}>Reviewers checked {V.unique} tasks · {V.pending} are waiting for a check right now</p></div>
          <div className="kpis">
            <Link className="kpi" href={`/queue?tab=review&over=1&from=${M.isoDate(now - 60 * 864e5)}&to=${today}${loc ? "&" + loc : ""}`}><span className={`rag ${rag(V.slaRate, 90, 75)}`} />
              <div className="lab">Checked in time</div><div className="v">{fmtP(V.slaRate)}</div><div className="sub">{V.onTime} checks were in time; {V.decisions - V.onTime} were late and {V.pendingOver} are still waiting past the limit</div><Delta cur={V.slaRate} prev={Vp.slaRate} /></Link>
            <div className="kpi"><div className="lab">Usual wait for a check</div><div className="v">{hrs(V.medianTat)}</div><div className="sub">Half of all tasks were checked faster than this</div>
              <Delta cur={V.medianTat === null ? null : V.medianTat / HOUR} prev={Vp.medianTat === null ? null : Vp.medianTat / HOUR} goodUp={false} unit="h" /></div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Second check: {V.audits ? `auditors re-checked ${V.audits} approved tasks and found problems in ${V.auditFails} (${Math.round((V.auditFails / V.audits) * 100)}%)` : "auditors didn't re-check any tasks in these dates"}</p>
        </section>
        <section className="card score">
          <div><h3>3 · How did tasks end up?</h3><p className="small muted" style={{ margin: 0 }}>Where each task with a passed deadline finished</p></div>
          <div className="kpis">
            <Link className="kpi" href={qhref("done")}><span className={`rag ${rag(E.verifiedRate, 80, 65)}`} />
              <div className="lab">Fully approved</div><div className="v">{fmtP(E.verifiedRate)}</div><div className="sub">{E.verified} of {E.due} tasks are done and approved. The rest are still being checked or fixed, or were never done</div><Delta cur={E.verifiedRate} prev={Ep.verifiedRate} /></Link>
            <Link className="kpi" href={qhref("missed")}><span className={`rag ${rag(E.missedRate, 5, 10, true)}`} />
              <div className="lab">Never done</div><div className="v">{fmtP(E.missedRate)}</div><div className="sub">{E.missed} of {E.due} tasks were skipped completely. Lower is better</div><Delta cur={E.missedRate} prev={Ep.missedRate} goodUp={false} /></Link>
          </div>
          <div className="row2">
            <Link href={`/queue?tab=notsub&from=${M.isoDate(now - 14 * 864e5)}&to=${today}${loc ? "&" + loc : ""}`}><b>{recoverable.length}</b> late tasks can still be done today</Link>
            <span className="spacer" />
            {recoverable.length > 0 && <RemindAll ids={recoverable.map((r) => r.id)} />}
          </div>
        </section>
      </div>

      <div className="grid g2">
        <section className="card">
          <div className="row2"><h2 style={{ margin: 0 }}>Fix these first</h2><span className="spacer" /><span className="small muted">{att.length} problems, most serious and oldest at the top</span></div>
          {!att.length && <p className="muted">Nothing is overdue. Good day.</p>}
          {att.slice(0, 12).map((a, i) => (
            <Link key={i} href={a.href} className="att" style={{ color: "var(--fg)" }}>
              <span className={`sev ${a.sev}`} />
              <div style={{ minWidth: 0 }}><div className="tname" style={{ fontSize: 13.5 }}>{a.title}</div><div className="tsub">{a.sub}</div></div>
              <span className="small muted" style={{ textAlign: "right" }}>Owner<br /><b style={{ color: "var(--fg)" }}>{a.owner}</b></span>
            </Link>
          ))}
          {att.length > 12 && <p className="small"><Link href={qhref("review", "&over=1")}>See all in the Review Queue</Link></p>}
        </section>
        <section className="card">
          <h2>Why tasks get sent back</h2>
          <p className="small muted" style={{ marginTop: -4 }}>Each time a reviewer sends a task back, they pick a reason. Longer bar = happened more often</p>
          {!reasons.length && <p className="muted">No flags in this period.</p>}
          <div className="grid" style={{ gap: 8 }}>
            {reasons.map((r) => (
              <div key={r.reason} style={{ display: "grid", gridTemplateColumns: "130px 1fr 40px", gap: 8, alignItems: "center" }}>
                <span className="small">{r.reason}</span>
                <div className="bar"><i style={{ width: `${(r.n / maxReason) * 100}%`, background: "var(--amber)" }} /></div>
                <span className="small n" style={{ textAlign: "right" }}>{r.n}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section>
        <div className="row2" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Properties, the ones needing most help first</h2><span className="spacer" /><span className="small muted">Click a property to see its tasks</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Property</th><th>City · Area</th><th>Manager (CBM)</th><th className="n">Tasks due</th><th className="n">Done on time</th><th className="n">Change</th><th className="n">Right first time</th><th className="n">Never done</th><th className="n">Waiting for a check</th><th>On time, day by day</th></tr></thead>
          <tbody>{propRows.map(({ g, e, ep, pending, spark, cbm }) => {
            const pq = `&prop=${encodeURIComponent(g.property)}`;
            const d = e.onTimeRate !== null && ep.onTimeRate !== null ? Math.round(e.onTimeRate - ep.onTimeRate) : null;
            return (
              <tr key={g.id}>
                <td><Link href={`/queue?tab=review&from=${R.from}&to=${R.to}${pq}`}>{g.property}</Link></td>
                <td className="muted">{g.city} · {g.cluster}</td><td>{cbm}</td>
                <td className="n">{e.due}</td>
                <td className="n"><span className={`pill ${rag(e.onTimeRate, 85, 70)}`}>{fmtP(e.onTimeRate)}</span></td>
                <td className="n" style={{ color: d === null ? undefined : d >= 0 ? "var(--green)" : "var(--red)" }}>{d === null ? "—" : `${d > 0 ? "+" : ""}${d}`}</td>
                <td className="n"><Link href={`/queue?tab=changes&from=${R.from}&to=${R.to}${pq}`}>{fmtP(e.fpaRate)}</Link></td>
                <td className="n"><Link href={`/queue?tab=missed&from=${R.from}&to=${R.to}${pq}`}>{e.missed}</Link></td>
                <td className="n"><Link href={`/queue?tab=review&from=${M.isoDate(now - 60 * 864e5)}&to=${today}${pq}`}>{pending}</Link></td>
                <td><Spark data={spark} /></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>

      <div className="grid g2">
        <section>
          <h2>Reviewers</h2>
          <div className="tbl"><table>
            <thead><tr><th>Reviewer</th><th className="n">Checks done</th><th className="n">Checked in time</th><th className="n">Usual wait</th><th className="n">Waiting now</th><th className="n">Waiting too long</th><th className="n">Approved, then reopened</th><th className="n">Auditor found problems</th></tr></thead>
            <tbody>{reviewers.map((r) => (
              <tr key={r.name}><td>{r.name}</td><td className="n">{r.v.decisions} <span className="muted small">({r.v.unique} tasks)</span></td>
                <td className="n"><span className={`pill ${rag(r.v.slaRate, 90, 75)}`}>{fmtP(r.v.slaRate)}</span></td><td className="n">{hrs(r.v.medianTat)}</td>
                <td className="n">{r.v.pending}</td><td className="n" style={{ color: r.v.pendingOver ? "var(--red)" : undefined }}>{r.v.pendingOver}</td>
                <td className="n">{r.reopen}</td><td className="n">{r.audited ? `${r.disagree} of ${r.audited}` : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section>
          <h2>CBMs</h2>
          <div className="tbl"><table>
            <thead><tr><th>Manager (CBM)</th><th className="n">Properties</th><th className="n">Tasks due</th><th className="n">Done on time</th><th className="n">Right first time</th><th className="n">Never done</th><th className="n">Auditor questions to answer</th></tr></thead>
            <tbody>{cbms.map((c) => (
              <tr key={c.name}><td>{c.name}</td><td className="n">{c.props}</td><td className="n">{c.e.due}</td>
                <td className="n"><span className={`pill ${rag(c.e.onTimeRate, 85, 70)}`}>{fmtP(c.e.onTimeRate)}</span></td>
                <td className="n">{fmtP(c.e.fpaRate)}</td><td className="n">{c.e.missed}</td><td className="n">{c.flags}</td></tr>
            ))}</tbody>
          </table></div>
          <p className="small muted">Each property has one manager, so these rows add up to the total.</p>
        </section>
      </div>
    </div>
  );
}
