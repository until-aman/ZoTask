"use client";
// Shared pieces of the command center: the drill-down context, clickable figures, a sortable table and small charts.
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { K, T } from "@/lib/command";
import InfoTip from "@/components/InfoTip";
import { PAGE, Pager, nextSort } from "@/components/ui/Filters";

export const HOUR = 3600_000;
export const fmtP = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
export const dur = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return "—";
  const h = ms / HOUR;
  return h < 1 ? `${Math.max(1, Math.round(ms / 60000))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
export const rag = (v: number | null | undefined, g: number, a: number, lowerBetter = false) =>
  v === null || v === undefined ? "" : lowerBetter ? (v <= g ? "g" : v <= a ? "a" : "r") : v >= g ? "g" : v >= a ? "a" : "r";
export const RAG_LABEL: Record<string, string> = { g: "Healthy", a: "Watch", r: "Act now", "": "No data" };

/** Opens a list of tasks, or one task, in the side drawer. */
export type Drill = { title: string; note?: string; ids: number[] };
export const DrillCtx = createContext<{ tasks: Record<number, T>; open: (d: Drill) => void; task: (id: number) => void }>({ tasks: {}, open: () => {}, task: () => {} });
export const useDrill = () => useContext(DrillCtx);

/** A count that opens its tasks. */
export function N({ ids, title, note, children, className = "" }: { ids: number[]; title: string; note?: string; children?: ReactNode; className?: string }) {
  const { open } = useDrill();
  if (!ids.length) return <span className={`muted ${className}`}>{children ?? 0}</span>;
  return <button type="button" className={`num ${className}`} onClick={() => open({ title, note, ids })} title="Show these tasks">{children ?? ids.length}</button>;
}

export function Delta({ cur, prev, goodUp = true, unit = "pts" }: { cur: number | null | undefined; prev: number | null | undefined; goodUp?: boolean; unit?: string }) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return <span className="d flat">no earlier data</span>;
  const d = Math.round((cur - prev) * 10) / 10;
  if (Math.abs(d) < 0.5) return <span className="d flat">→ same as before</span>;
  const good = goodUp ? d > 0 : d < 0;
  return <span className={`d ${good ? "up" : "down"}`} title={`Change vs the previous period of the same length (was ${prev}${unit === "pts" ? "%" : unit})`}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}{unit === "pts" ? " pts" : unit}</span>;
}

/** What a figure means, shown in its own "i". */
export type Def = { means: string; calc?: string; note?: string };
function DefTip({ label, def, k, rate, target }: { label: string; def: Def; k?: K; rate?: boolean; target?: string }) {
  const rows: [string, string][] = [["Means", def.means]];
  if (def.calc) rows.push(["Formula", def.calc]);
  if (k && rate && k.of !== undefined) rows.push(["Now", `${k.n} of ${k.of} = ${k.rate ?? "—"}%`]);
  if (target) rows.push(["Target", target.replace(/^Target /, "")]);
  return <InfoTip title={label} rows={rows} note={def.note ?? (k?.ids.length ? "Click the figure to see these tasks." : undefined)} />;
}

/** A headline figure. Clicking it lists the tasks behind it. */
export function Tile({ label, def, k, rate = true, goodUp = true, band, target, unitNote }: {
  label: string; def: Def; k: K; rate?: boolean; goodUp?: boolean; band?: [number, number]; target?: string; unitNote?: string;
}) {
  const { open } = useDrill();
  const v = rate ? k.rate ?? null : k.n;
  const r = band ? rag(v, band[0], band[1], !goodUp) : "";
  const act = () => k.ids.length && open({ title: label, note: unitNote, ids: k.ids });
  return (
    <div className={`kpi ${k.ids.length ? "click" : ""}`} role="button" tabIndex={0} onClick={act} onKeyDown={(e) => { if (e.key === "Enter") act(); }} aria-label={`${label}: show tasks`}>
      {band && <span className={`rag ${r}`} title={RAG_LABEL[r]} />}
      <div className="lab">{label}<DefTip label={label} def={def} k={k} rate={rate} target={target} /></div>
      <div className="v">{rate ? fmtP(v) : k.n}{rate && k.of !== undefined && <small>{k.n} of {k.of}</small>}</div>
      <div className="foot">{k.prev !== undefined ? <Delta cur={v} prev={k.prev} goodUp={goodUp} unit={rate ? "pts" : ""} /> : <span />}{target && <span className="tgt">{target}</span>}</div>
    </div>
  );
}

/** A small clickable count in a strip under the headline tiles. */
export function Mini({ label, k, tone, def, of }: { label: string; k: K; tone?: "r" | "a" | "g"; def: Def; of?: boolean }) {
  const { open } = useDrill();
  const act = () => k.ids.length && open({ title: label, note: def.means, ids: k.ids });
  return (
    <div className={`mini ${k.ids.length ? "click" : ""}`} role="button" tabIndex={0} onClick={act} onKeyDown={(e) => { if (e.key === "Enter") act(); }}>
      <b className={tone ? `t-${tone}` : ""}>{k.n}</b><span>{label}{of && k.of !== undefined ? <small> of {k.of}</small> : null}</span><DefTip label={label} def={def} />
    </div>
  );
}

export function Spark({ data, color = "var(--blue)", max = 100 }: { data: (number | null)[]; color?: string; max?: number }) {
  const w = 80, h = 24;
  const pts = data.map((v, i) => (v === null ? null : [i * (w / Math.max(1, data.length - 1)), h - 2 - (v / (max || 1)) * (h - 4)])).filter(Boolean) as number[][];
  if (pts.length < 2) return <span className="muted small">—</span>;
  return <svg className="spark" width={w} height={h} aria-hidden="true"><polyline fill="none" stroke={color} strokeWidth="1.6" points={pts.map((p) => p.join(",")).join(" ")} /></svg>;
}

export function Sec({ title, tip, right, children, id }: { title: string; tip?: ReactNode; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card sec" id={id}>
      <div className="sech"><h2>{title}{tip}</h2><span className="spacer" />{right}</div>
      {children}
    </section>
  );
}

export type Col<R> = { key: string; label: string; num?: boolean; value: (r: R) => number | string | null; render?: (r: R) => ReactNode; csv?: (r: R) => string | number | null; hidden?: boolean; tip?: ReactNode; sticky?: boolean };

/** Sortable, searchable table with column picker, paging, CSV export and optional row expansion.
 *  Pass `query` when the page has its own search box; the table then hides its own. */
export function Table<R>({ cols, rows, rowKey, search, expand, pageSize = PAGE, toolbar, initialSort, name, empty = "Nothing to show for these filters.", query }: {
  cols: Col<R>[]; rows: R[]; rowKey: (r: R) => string | number; search?: (r: R) => string; expand?: (r: R) => ReactNode;
  pageSize?: number; toolbar?: ReactNode; initialSort?: { key: string; dir: 1 | -1 }; name: string; empty?: string; query?: string;
}) {
  const [own, setQ] = useState("");
  const q = query ?? own;
  const [sort, setSort] = useState(initialSort ?? null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(cols.filter((c) => c.hidden).map((c) => c.key)));
  const [page, setPage] = useState(0);
  const [openRows, setOpenRows] = useState<Set<string | number>>(new Set());
  const [pick, setPick] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const shown = cols.filter((c) => !hidden.has(c.key));
  const list = useMemo(() => {
    const text = search ?? ((r: R) => cols.map((c) => String(c.value(r) ?? "")).join(" "));
    let l = q ? rows.filter((r) => text(r).toLowerCase().includes(q.toLowerCase())) : rows;
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      if (c) l = [...l].sort((a, b) => {
        const x = c.value(a), y = c.value(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    }
    return l;
  }, [rows, q, sort, cols, search]);
  useEffect(() => setPage(0), [query]);
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const pg = Math.min(page, pages - 1);
  const view = list.slice(pg * pageSize, pg * pageSize + pageSize);
  const toCsv = () => {
    const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.map((c) => esc(c.label)).join(","), ...list.map((r) => cols.map((c) => esc(c.csv ? c.csv(r) : c.value(r))).join(","))].join("\n");
  };
  return (
    <div className="ttable">
      <div className="ttool">
        {query === undefined && <input type="search" placeholder="Search" value={own} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label={`Search ${name}`} className="search" />}
        {toolbar}
        <span className="spacer" />
        <span className="pickwrap">
          <button type="button" className="btn sm" onClick={() => setPick(!pick)} aria-expanded={pick}>Columns</button>
          {pick && <div className="pop right" onMouseLeave={() => setPick(false)}>
            {cols.map((c) => (
              <label key={c.key} className="opt"><input type="checkbox" checked={!hidden.has(c.key)} disabled={c.sticky}
                onChange={() => { const n = new Set(hidden); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); setHidden(n); }} />{c.label}</label>
            ))}
          </div>}
        </span>
        <button type="button" className="btn sm" onClick={() => setCsv(toCsv())}>Export CSV</button>
      </div>
      <div className="tbl sticky"><table className="tt">
        <thead><tr>
          {expand && <th style={{ width: 28 }} />}
          {shown.map((c) => (
            <th key={c.key} className={c.num ? "n" : ""} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
              <button type="button" className="sortbtn" onClick={() => { setSort(nextSort(sort, c.key)); setPage(0); }}>
                {c.label}<span className="sorti">{sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
              </button>{c.tip}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {!view.length && <tr><td colSpan={shown.length + (expand ? 1 : 0)} className="muted" style={{ textAlign: "center", padding: 20 }}>{empty}</td></tr>}
          {view.map((r) => {
            const key = rowKey(r), isOpen = openRows.has(key);
            return [
              <tr key={key} className={isOpen ? "open" : ""}>
                {expand && <td><button type="button" className="exp" aria-expanded={isOpen} aria-label="Show details"
                  onClick={() => { const n = new Set(openRows); if (isOpen) n.delete(key); else n.add(key); setOpenRows(n); }}>{isOpen ? "▾" : "▸"}</button></td>}
                {shown.map((c) => <td key={c.key} className={c.num ? "n" : ""}>{c.render ? c.render(r) : c.value(r) ?? "—"}</td>)}
              </tr>,
              isOpen && expand ? <tr key={`${key}-x`} className="xrow"><td colSpan={shown.length + 1}>{expand(r)}</td></tr> : null,
            ];
          })}
        </tbody>
      </table></div>
      <Pager page={pg} total={list.length} size={pageSize} setPage={setPage} />
      {csv !== null && <CopyModal title={`Export ${name}`} text={csv} file={`${name.toLowerCase().replace(/\W+/g, "-")}.csv`} close={() => setCsv(null)} />}
    </div>
  );
}

/** Shows text to copy or download. Falls back to selecting the text when the clipboard is blocked. */
export function CopyModal({ title, text, file, close, extra }: { title: string; text: string; file?: string; close: () => void; extra?: ReactNode }) {
  const [msg, setMsg] = useState("");
  const copy = async (el: HTMLTextAreaElement | null) => {
    try { await navigator.clipboard.writeText(text); setMsg("Copied"); }
    catch { el?.select(); try { document.execCommand("copy"); setMsg("Copied"); } catch { setMsg("Text selected. Press Ctrl+C or ⌘C to copy."); } }
  };
  let ta: HTMLTextAreaElement | null = null;
  return (
    <div className="modal" onClick={close}>
      <div className="mcard wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="row2"><h2 style={{ margin: 0 }}>{title}</h2><span className="spacer" /><button type="button" className="x" onClick={close} aria-label="Close">×</button></div>
        <textarea ref={(el) => { ta = el; }} readOnly value={text} style={{ minHeight: 260, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12 }} />
        <div className="row2">
          <button type="button" className="btn primary" onClick={() => copy(ta)}>Copy</button>
          {file && <a className="btn" href={`data:${file.endsWith(".csv") ? "text/csv" : "text/markdown"};charset=utf-8,${encodeURIComponent(text)}`} download={file}>Download</a>}
          {extra}
          {msg && <span className="small ok" style={{ padding: "4px 10px" }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

export { InfoTip, DefTip };
