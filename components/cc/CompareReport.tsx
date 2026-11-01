"use client";
// The comparison report as a clean, printable page: summary, ranking, metrics, then one section per person.
import { useEffect, useState } from "react";

type Cell = { v: string; of: string; tone: "best" | "worst" | "" };
export type Rep = {
  title: string; one: string; names: string[]; colors: string[]; period: string; generated: string; file: string;
  ranking: { place: number; label: string; sub: string; color: string; avgPos: string; bestOn: number; worstOn: number; tasks: number; few: boolean }[];
  metrics: { label: string; scored: boolean; best: string; cells: Cell[] }[];
  people: {
    place: number; label: string; sub: string; color: string;
    ahead: { metric: string; value: string; avg: string; top: boolean }[];
    behind: { metric: string; value: string; avg: string; best: string; leader: string; gap: string }[];
    typesTitle: string; types: { task: string; onTime: string; due: number; missed: number }[];
    reasons: { reason: string; n: number }[]; actions: string[];
  }[];
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Plain text for chat apps: no tables, just short lines. */
function toText(r: Rep) {
  const L: string[] = [`${r.title.toUpperCase()}`, r.names.join(" vs "), `Period: ${r.period}`, `Generated: ${r.generated}`, ""];
  L.push(`Top performer: ${r.ranking[0].label}`, `Needs the most support: ${r.ranking[r.ranking.length - 1].label}`, "", "RANKING");
  for (const x of r.ranking) L.push(`${x.place}. ${x.label}: best on ${x.bestOn}, worst on ${x.worstOn}, ${plural(x.tasks, "task")}${x.few ? " (few tasks)" : ""}`);
  L.push("", "METRICS");
  for (const m of r.metrics) L.push(`${m.label}: ${m.cells.map((c, i) => `${r.names[i]} ${c.v}`).join(", ")}${m.scored ? ` (best: ${m.best})` : ""}`);
  for (const p of r.people) {
    L.push("", `${p.place}. ${p.label.toUpperCase()}${p.sub ? ` (${p.sub})` : ""}`);
    if (p.ahead.length) { L.push("Doing well:"); p.ahead.forEach((x) => L.push(`  + ${x.metric}: ${x.value} (avg ${x.avg})${x.top ? ", best in group" : ""}`)); }
    if (p.behind.length) { L.push("Needs improvement:"); p.behind.forEach((x) => L.push(`  - ${x.metric}: ${x.value} (avg ${x.avg}, best ${x.best} by ${x.leader})`)); }
    if (p.types.length) { L.push(`${p.typesTitle}:`); p.types.forEach((t) => L.push(`  • ${t.task}: ${t.onTime} of ${t.due}${t.missed ? `, ${t.missed} missed` : ""}`)); }
    if (p.reasons.length) { L.push("Top send-back reasons:"); p.reasons.forEach((x) => L.push(`  • ${x.reason}: ${plural(x.n, "task")}`)); }
    if (p.actions.length) { L.push("Next steps:"); p.actions.forEach((a) => L.push(`  → ${a}`)); }
  }
  return L.join("\n");
}

/** HTML with inline styles, so tables survive a paste into Gmail, Outlook or Google Docs. */
function toHtml(r: Rep) {
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const th = "padding:6px 10px;border:1px solid #d9dee8;background:#f3f5f9;text-align:left;font-size:12px", td = "padding:6px 10px;border:1px solid #d9dee8;font-size:13px";
  const tone = (t: string) => (t === "best" ? "background:#e7f6ec;color:#166534;font-weight:600" : t === "worst" ? "background:#fdecec;color:#b91c1c" : "");
  let h = `<div style="font-family:Arial,sans-serif;color:#172033"><h2 style="margin:0 0 4px">${e(r.title)}</h2><div style="color:#5b6577;font-size:13px">${e(r.names.join(" vs "))} · ${e(r.period)} · generated ${e(r.generated)}</div>`;
  h += `<p style="font-size:14px"><b>Top performer:</b> ${e(r.ranking[0].label)} &nbsp; <b>Needs the most support:</b> ${e(r.ranking[r.ranking.length - 1].label)}</p>`;
  h += `<h3>Ranking</h3><table style="border-collapse:collapse"><tr><th style="${th}">#</th><th style="${th}">${e(r.one)}</th><th style="${th}">Best on</th><th style="${th}">Worst on</th><th style="${th}">Tasks</th></tr>`;
  for (const x of r.ranking) h += `<tr><td style="${td}">${x.place}</td><td style="${td}"><b>${e(x.label)}</b></td><td style="${td}">${x.bestOn}</td><td style="${td}">${x.worstOn}</td><td style="${td}">${x.tasks}${x.few ? " (few)" : ""}</td></tr>`;
  h += `</table><h3>Metrics</h3><table style="border-collapse:collapse"><tr><th style="${th}">Metric</th>${r.names.map((n) => `<th style="${th}">${e(n)}</th>`).join("")}</tr>`;
  for (const m of r.metrics) h += `<tr><td style="${td}">${e(m.label)}</td>${m.cells.map((c) => `<td style="${td};${tone(c.tone)}">${e(c.v)}${c.of ? `<br><span style="font-size:11px;color:#5b6577">${e(c.of)}</span>` : ""}</td>`).join("")}</tr>`;
  h += "</table>";
  for (const p of r.people) {
    h += `<h3>${p.place}. ${e(p.label)}${p.sub ? ` <span style="font-weight:normal;color:#5b6577">(${e(p.sub)})</span>` : ""}</h3>`;
    if (p.ahead.length) h += `<p style="margin:4px 0"><b style="color:#166534">Doing well</b></p><ul>${p.ahead.map((x) => `<li>${e(x.metric)}: <b>${e(x.value)}</b> (avg ${e(x.avg)})${x.top ? " · best in group" : ""}</li>`).join("")}</ul>`;
    if (p.behind.length) h += `<p style="margin:4px 0"><b style="color:#b91c1c">Needs improvement</b></p><ul>${p.behind.map((x) => `<li>${e(x.metric)}: <b>${e(x.value)}</b> (avg ${e(x.avg)}, best ${e(x.best)} by ${e(x.leader)})</li>`).join("")}</ul>`;
    if (p.actions.length) h += `<p style="margin:4px 0"><b>Next steps</b></p><ol>${p.actions.map((a) => `<li>${e(a)}</li>`).join("")}</ol>`;
  }
  return h + "</div>";
}

export default function CompareReport({ rep: r, close }: { rep: Rep; close: () => void }) {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    document.body.classList.add("printing-report");
    return () => { document.removeEventListener("keydown", esc); document.body.classList.remove("printing-report"); };
  }, [close]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 3000); return () => clearTimeout(t); }, [msg]);

  async function copy(rich: boolean) {
    const text = toText(r);
    try {
      if (rich && typeof ClipboardItem !== "undefined") await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([toHtml(r)], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      else await navigator.clipboard.writeText(text);
      setMsg(rich ? "Copied with tables. Paste into an email or doc." : "Copied as plain text. Paste into WhatsApp or Slack.");
    } catch { setMsg("Copy is blocked here. Use Print or Save as PDF instead."); }
  }
  function print() {
    try { window.print(); } catch { setMsg("Printing is blocked here. It works in the real app."); }
  }

  const top = r.ranking[0], low = r.ranking[r.ranking.length - 1];
  return (
    <div className="rptwrap" role="dialog" aria-label={r.title} onClick={close}>
      <div className="rpt-bar" onClick={(ev) => ev.stopPropagation()}>
        <b>Comparison report</b><span className="spacer" />
        {msg && <span className="small ok">{msg}</span>}
        <button type="button" className="btn sm" onClick={() => copy(false)}>Copy text</button>
        <button type="button" className="btn sm" onClick={() => copy(true)}>Copy for email</button>
        <button type="button" className="btn sm primary" onClick={print}>Print / Save PDF</button>
        <button type="button" className="x" onClick={close} aria-label="Close">×</button>
      </div>
      <article className="rpt" onClick={(ev) => ev.stopPropagation()}>
        <header className="rpt-head">
          <div className="rpt-brand"><span className="logo">Ω</span>ZoTask</div>
          <h1>{r.title}</h1>
          <div className="rpt-names">{r.names.map((n, i) => <span key={n}><i style={{ background: r.colors[i] }} />{n}</span>)}</div>
          <dl className="rpt-meta"><div><dt>Period</dt><dd>{r.period}</dd></div><div><dt>Generated</dt><dd>{r.generated}</dd></div><div><dt>Counting</dt><dd>Each task counted once</dd></div></dl>
        </header>

        <section className="rpt-sum">
          <div className="rpt-call g"><span>Top performer</span><b>{top.label}</b><small>Best on {plural(top.bestOn, "metric")}, worst on {top.worstOn}</small></div>
          <div className="rpt-call r"><span>Needs the most support</span><b>{low.label}</b><small>Worst on {plural(low.worstOn, "metric")}, best on {low.bestOn}</small></div>
        </section>

        <section>
          <h2>Ranking</h2>
          <p className="rpt-note">By average position across the scored metrics. 1.0 means best on every metric.</p>
          <div className="rpt-scroll"><table className="rpt-t">
            <thead><tr><th>#</th><th>{r.one}</th><th className="n">Average position</th><th className="n">Best on</th><th className="n">Worst on</th><th className="n">Tasks</th></tr></thead>
            <tbody>{r.ranking.map((x) => <tr key={x.label}>
              <td><span className={`rpt-place p${Math.min(x.place, 4)}`}>{x.place}</span></td>
              <td><i className="rpt-dot" style={{ background: x.color }} /><b>{x.label}</b>{x.sub && <span className="rpt-sub">{x.sub}</span>}</td>
              <td className="n">{x.avgPos}</td><td className="n">{x.bestOn}</td><td className="n">{x.worstOn}</td>
              <td className="n">{x.tasks}{x.few && <span className="rpt-warn" title="Fewer than 10 tasks, read with care"> few</span>}</td>
            </tr>)}</tbody>
          </table></div>
        </section>

        <section>
          <h2>Metrics side by side</h2>
          <p className="rpt-note"><span className="rpt-key best">Best</span> <span className="rpt-key worst">Worst</span> in the group. Metrics without a right direction are shown for context only.</p>
          <div className="rpt-scroll"><table className="rpt-t rpt-m">
            <thead><tr><th>Metric</th>{r.names.map((n, i) => <th key={n} className="n"><i className="rpt-dot" style={{ background: r.colors[i] }} />{n}</th>)}</tr></thead>
            <tbody>{r.metrics.map((m) => <tr key={m.label} className={m.scored ? "" : "ctx"}>
              <td>{m.label}</td>
              {m.cells.map((c, i) => <td key={i} className={`n ${c.tone}`}>{c.v}{c.of && <small>{c.of}</small>}</td>)}
            </tr>)}</tbody>
          </table></div>
        </section>

        {r.people.map((p) => (
          <section key={p.label} className="rpt-person">
            <h2><span className={`rpt-place p${Math.min(p.place, 4)}`}>{p.place}</span><i className="rpt-dot" style={{ background: p.color }} />{p.label}{p.sub && <span className="rpt-sub">{p.sub}</span>}</h2>
            <div className="rpt-two">
              <div className="rpt-box g"><h3>Doing well</h3>
                {p.ahead.length ? <ul>{p.ahead.map((x) => <li key={x.metric}><span>{x.metric}</span><b>{x.value}</b><small>avg {x.avg}{x.top ? " · best in group" : ""}</small></li>)}</ul>
                  : <p className="rpt-note">Not above the group average on any metric.</p>}
              </div>
              <div className="rpt-box r"><h3>Needs improvement</h3>
                {p.behind.length ? <ul>{p.behind.map((x) => <li key={x.metric}><span>{x.metric}</span><b>{x.value}</b><small>avg {x.avg} · best {x.best} ({x.leader}), {x.gap} behind</small></li>)}</ul>
                  : <p className="rpt-note">Not below the group average on any metric.</p>}
              </div>
            </div>
            {(p.types.length > 0 || p.reasons.length > 0) && <div className="rpt-two">
              {p.types.length > 0 && <div><h3>{p.typesTitle}</h3><table className="rpt-t sm"><tbody>{p.types.map((t) => <tr key={t.task}><td>{t.task}</td><td className="n"><b>{t.onTime}</b> of {t.due}</td><td className="n">{t.missed ? <span className="worst-t">{t.missed} missed</span> : ""}</td></tr>)}</tbody></table></div>}
              {p.reasons.length > 0 && <div><h3>Most common send-back reasons</h3><table className="rpt-t sm"><tbody>{p.reasons.map((x) => <tr key={x.reason}><td>{x.reason}</td><td className="n">{plural(x.n, "task")}</td></tr>)}</tbody></table></div>}
            </div>}
            {p.actions.length > 0 && <div className="rpt-act"><h3>Next steps</h3><ol>{p.actions.map((a) => <li key={a}>{a}</li>)}</ol></div>}
          </section>
        ))}
        <footer className="rpt-foot">ZoTask · {r.title} · {r.period}</footer>
      </article>
    </div>
  );
}
