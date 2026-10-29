import Link from "next/link";
import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can, scopeProps } from "@/lib/auth";
import { geo, Row } from "@/lib/queries";
import { all } from "@/lib/db";
import * as M from "@/lib/metrics";
import { HOUR, fmtDate, isoDate } from "@/lib/time";
import RemindAll from "@/components/RemindAll";
import InfoTip from "@/components/InfoTip";
import DashFilters from "@/components/DashFilters";

type SP = Record<string, string | undefined>;
const PRESETS: [string, string][] = [["today", "Today"], ["yday", "Yesterday"], ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"]];

function Delta({ cur, prev, goodUp = true, unit = " pts" }: { cur: number | null; prev: number | null; goodUp?: boolean; unit?: string }) {
  if (cur === null || prev === null) return <span className="d flat">—</span>;
  const d = Math.round((cur - prev) * 10) / 10;
  if (Math.abs(d) < 0.5) return <span className="d flat">→ no change</span>;
  const good = goodUp ? d > 0 : d < 0;
  return <span className={`d ${good ? "up" : "down"}`} title="Compared with the same number of days just before">{d > 0 ? "▲" : "▼"} {Math.abs(d)}{unit === " pts" ? " pts" : unit}</span>;
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
  const staff = all<{ property_id: number; ideal_hk: number; current_hk: number; ideal_shk: number; current_shk: number }>(
    `SELECT * FROM staffing WHERE property_id IN (${props.join(",") || 0})`);
  const hk = staff.reduce((t, x) => ({ ihk: t.ihk + x.ideal_hk, chk: t.chk + x.current_hk, ishk: t.ishk + x.ideal_shk, cshk: t.cshk + x.current_shk }), { ihk: 0, chk: 0, ishk: 0, cshk: 0 });
  const gaps = staff.map((x) => ({ ...x, name: G.find((g) => g.id === x.property_id)!.property, hkGap: Math.max(0, x.ideal_hk - x.current_hk), shkGap: Math.max(0, x.ideal_shk - x.current_shk) }))
    .sort((a, b) => b.hkGap + b.shkGap - (a.hkGap + a.shkGap));
  const recoverable = open.filter((r) => r.status === "notsub");
  const maxReason = Math.max(1, ...reasons.map((r) => r.n));

  return (
    <div className="page">
      <div className="row2">
        <div>
          <h1>Operations command center</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>{R.from === R.to ? fmtDate(R.from) : `${fmtDate(R.from)} – ${fmtDate(R.to)}`} vs {P.from === P.to ? fmtDate(P.from) : `${fmtDate(P.from)} – ${fmtDate(P.to)}`} · {props.length} properties · updated {new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      </div>
      <DashFilters geo={G} init={{ range: preset, city: sp.city, cluster: sp.cluster, prop: sp.prop }} range={R} />

      <div className="grid g3">
        <section className="card score">
          <h3>Property team<InfoTip>Tasks whose deadline has passed ({E.due}). <b>On time</b>: finished before the deadline. <b>Right first time</b>: approved without being sent back. The dot is green when good, amber to watch, red when it needs help.</InfoTip></h3>
          <div className="kpis">
            <Link className="kpi" href={qhref("done")}><span className={`rag ${rag(E.onTimeRate, 85, 70)}`} />
              <div className="lab">On time</div><div className="v">{fmtP(E.onTimeRate)}<small>{E.onTime}/{E.due}</small></div><Delta cur={E.onTimeRate} prev={Ep.onTimeRate} /></Link>
            <Link className="kpi" href={qhref("changes")}><span className={`rag ${rag(E.fpaRate, 80, 65)}`} />
              <div className="lab">Right first time</div><div className="v">{fmtP(E.fpaRate)}<small>{E.fpa}/{E.decided}</small></div><Delta cur={E.fpaRate} prev={Ep.fpaRate} /></Link>
          </div>
          <div>
            <div className="bar" aria-label="On time, late, still open, never done">
              {[[E.onTime, "var(--green)"], [E.late, "var(--amber)"], [E.open, "var(--blue)"], [E.missed, "var(--red)"]].map(([n, c], i) => <i key={i} style={{ width: `${E.due ? ((n as number) / E.due) * 100 : 0}%`, background: c as string }} />)}
            </div>
            <div className="legend">
              <span><b style={{ color: "var(--green)" }}>●</b> On time {E.onTime}</span><span><b style={{ color: "var(--amber)" }}>●</b> Late {E.late}</span>
              <Link href={qhref("notsub")}><b style={{ color: "var(--blue)" }}>●</b> Still open {E.open}</Link><Link href={qhref("missed")}><b style={{ color: "var(--red)" }}>●</b> Missed {E.missed}</Link>
            </div>
          </div>
        </section>
        <section className="card score">
          <h3>Reviewers<InfoTip><b>In time</b>: checks done within each task&apos;s time limit, counting tasks still waiting past the limit as late. <b>Usual wait</b>: half of tasks were checked faster than this. {V.audits ? `Auditors re-checked ${V.audits} approved tasks and found problems in ${V.auditFails}.` : ""}</InfoTip></h3>
          <div className="kpis">
            <Link className="kpi" href={`/queue?tab=review&over=1&from=${M.isoDate(now - 60 * 864e5)}&to=${today}${loc ? "&" + loc : ""}`}><span className={`rag ${rag(V.slaRate, 90, 75)}`} />
              <div className="lab">Checked in time</div><div className="v">{fmtP(V.slaRate)}<small>{V.onTime}/{V.decisions + V.pendingOver}</small></div><Delta cur={V.slaRate} prev={Vp.slaRate} /></Link>
            <div className="kpi"><div className="lab">Usual wait</div><div className="v">{hrs(V.medianTat)}</div>
              <Delta cur={V.medianTat === null ? null : V.medianTat / HOUR} prev={Vp.medianTat === null ? null : Vp.medianTat / HOUR} goodUp={false} unit="h" /></div>
          </div>
          <div className="legend"><span>{V.pending} waiting now</span>{V.pendingOver ? <span style={{ color: "var(--red)" }}>{V.pendingOver} overdue</span> : null}</div>
        </section>
        <section className="card score">
          <h3>Outcome<InfoTip><b>Approved</b>: tasks fully done and approved. The rest are still being checked or fixed, or were missed. <b>Missed</b>: never done at all, lower is better. {E.waived ? `${E.waived} cancelled tasks aren't counted.` : ""}</InfoTip></h3>
          <div className="kpis">
            <Link className="kpi" href={qhref("done")}><span className={`rag ${rag(E.verifiedRate, 80, 65)}`} />
              <div className="lab">Approved</div><div className="v">{fmtP(E.verifiedRate)}<small>{E.verified}/{E.due}</small></div><Delta cur={E.verifiedRate} prev={Ep.verifiedRate} /></Link>
            <Link className="kpi" href={qhref("missed")}><span className={`rag ${rag(E.missedRate, 5, 10, true)}`} />
              <div className="lab">Missed</div><div className="v">{fmtP(E.missedRate)}<small>{E.missed}/{E.due}</small></div><Delta cur={E.missedRate} prev={Ep.missedRate} goodUp={false} /></Link>
          </div>
          <div className="row2">
            <Link href={`/queue?tab=notsub&from=${M.isoDate(now - 14 * 864e5)}&to=${today}${loc ? "&" + loc : ""}`} className="small"><b>{recoverable.length}</b> late, still fixable today</Link>
            <span className="spacer" />
            {recoverable.length > 0 && <RemindAll ids={recoverable.map((r) => r.id)} />}
          </div>
        </section>
      </div>

      <section className="card score">
        <h3>Housekeeping count<InfoTip><b>Ideal</b>: how many the property should have. <b>Current</b>: how many are on the roster today. <b>To hire</b>: Ideal minus Current. HK is a housekeeper, SHK a senior housekeeper (supervisor). Sample numbers in this prototype.</InfoTip></h3>
        <div className="hkgrid">
          {[["HK", hk.ihk, hk.chk], ["SHK", hk.ishk, hk.cshk]].map(([l, ideal, cur]) => {
            const gap = Math.max(0, (ideal as number) - (cur as number));
            return (
              <div key={l as string} className="kpi"><span className={`rag ${gap > 0 ? "r" : "g"}`} />
                <div className="lab">{l} to hire</div><div className="v" style={{ color: gap > 0 ? "var(--red)" : "var(--green)" }}>{gap}<small>{cur}/{ideal} in place</small></div></div>
            );
          })}
        </div>
        <details>
          <summary className="small" style={{ cursor: "pointer", color: "var(--blue-d)", fontWeight: 700 }}>By property</summary>
          <div className="tbl" style={{ marginTop: 8 }}><table>
            <thead><tr><th>Property</th><th className="n">Ideal HK</th><th className="n">Current HK</th><th className="n">HK to hire</th><th className="n">Ideal SHK</th><th className="n">Current SHK</th><th className="n">SHK to hire</th></tr></thead>
            <tbody>{gaps.map((x) => (
              <tr key={x.property_id}><td>{x.name}</td><td className="n">{x.ideal_hk}</td><td className="n">{x.current_hk}</td>
                <td className="n" style={{ color: x.hkGap ? "var(--red)" : undefined, fontWeight: x.hkGap ? 700 : undefined }}>{x.hkGap}</td>
                <td className="n">{x.ideal_shk}</td><td className="n">{x.current_shk}</td>
                <td className="n" style={{ color: x.shkGap ? "var(--red)" : undefined, fontWeight: x.shkGap ? 700 : undefined }}>{x.shkGap}</td></tr>
            ))}</tbody>
          </table></div>
        </details>
      </section>

      <div className="grid g2">
        <section className="card">
          <div className="row2"><h2 style={{ margin: 0, display: "flex", alignItems: "center" }}>Fix these first<InfoTip>Problems ranked by how serious and how old they are. Each one names who needs to act. Click to open the task.</InfoTip></h2><span className="spacer" /><span className="pill">{att.length}</span></div>
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
          <h2 style={{ display: "flex", alignItems: "center" }}>Why tasks get sent back<InfoTip>ZoTask doesn&apos;t collect this today. This prototype adds one step: when a reviewer sends a task back, they pick a reason (Photo missing, Photo unclear, Wrong location and so on). A longer bar means it happened more often.</InfoTip><span className="pill b" style={{ marginLeft: 8 }}>New</span></h2>
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
        <div className="row2" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Properties</h2><span className="spacer" /><span className="small muted">Weakest first</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Property</th><th>City · Cluster</th><th>Manager (CBM)</th><th className="n">Tasks due</th><th className="n">Done on time</th><th className="n">Change</th><th className="n">Right first time</th><th className="n">Never done</th><th className="n">To check</th><th>Trend</th></tr></thead>
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
            <thead><tr><th>Reviewer</th><th className="n">Checks</th><th className="n">Checked in time</th><th className="n">Usual wait</th><th className="n">Waiting now</th><th className="n">Overdue</th><th className="n">Reopened</th><th className="n">Audit fails</th></tr></thead>
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
            <thead><tr><th>Manager (CBM)</th><th className="n">Properties</th><th className="n">Tasks due</th><th className="n">Done on time</th><th className="n">Right first time</th><th className="n">Never done</th><th className="n">Audit questions</th></tr></thead>
            <tbody>{cbms.map((c) => (
              <tr key={c.name}><td>{c.name}</td><td className="n">{c.props}</td><td className="n">{c.e.due}</td>
                <td className="n"><span className={`pill ${rag(c.e.onTimeRate, 85, 70)}`}>{fmtP(c.e.onTimeRate)}</span></td>
                <td className="n">{fmtP(c.e.fpaRate)}</td><td className="n">{c.e.missed}</td><td className="n">{c.flags}</td></tr>
            ))}</tbody>
          </table></div>
          
        </section>
      </div>
    </div>
  );
}
