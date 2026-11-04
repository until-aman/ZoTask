"use client";
// Shared pieces of the command center: the drill-down context, clickable figures, a sortable table and small charts.
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { keyFor, useUrlState } from "@/components/ui/useUrlState";
import { ColumnsMenu, ExportMenu, Person, RowMenu, useHiddenCols, type RowAction } from "@/components/ui/TableKit";
import type { K, T } from "@/lib/command";
import InfoTip from "@/components/InfoTip";
import { Pager, clampPage, nextSort, usePageSize } from "@/components/ui/Filters";

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
    <div className={`kpi ${k.ids.length ? "click" : ""}`} role="group" tabIndex={0} onClick={act} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act(); } }} aria-label={`${label}: press Enter to show tasks`}>
      {band && <span className={`rag ${r}`} title={RAG_LABEL[r]} />}
      <div className="kpi-h"><div className="v">{rate ? fmtP(v) : k.n}</div><div className="lab">{label}<DefTip label={label} def={def} k={k} rate={rate} target={target} /></div></div>
      <div className="foot"><span className="kpi-m">{rate && k.of !== undefined && <span className="sub mono">{k.n} of {k.of}</span>}{k.prev !== undefined && <Delta cur={v} prev={k.prev} goodUp={goodUp} unit={rate ? "pts" : ""} />}</span>{target && <span className="tgt">{target}</span>}</div>
    </div>
  );
}

/** A small clickable count in a strip under the headline tiles. */
export function Mini({ label, k, tone, def, of }: { label: string; k: K; tone?: "r" | "a" | "g"; def: Def; of?: boolean }) {
  const { open } = useDrill();
  const act = () => k.ids.length && open({ title: label, note: def.means, ids: k.ids });
  return (
    <div className={`mini ${k.ids.length ? "click" : ""}`} role="group" tabIndex={0} onClick={act} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act(); } }} aria-label={`${label}: press Enter to show tasks`}>
      <b className={tone ? `t-${tone}` : ""}>{k.n}</b><span>{label}{of && k.of !== undefined ? <small> of {k.of}</small> : null}</span><DefTip label={label} def={def} />
    </div>
  );
}

export function Spark({ data, color = "var(--accent)", max = 100 }: { data: (number | null)[]; color?: string; max?: number }) {
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

export type Col<R> = { key: string; label: string; num?: boolean; value: (r: R) => number | string | null; render?: (r: R) => ReactNode; csv?: (r: R) => string | number | null; hidden?: boolean; tip?: ReactNode; sticky?: boolean;
  /** The value is a person's name: shown with their initials avatar. */
  person?: boolean };

/** Sortable, searchable table with column picker, paging, CSV export and optional row expansion.
 *  Pass `query` when the page has its own search box; the table then hides its own. */
export function Table<R>({ cols, rows, rowKey, search, expand, pageSize: fixed, toolbar, initialSort, name, empty = "Nothing to show for these filters.", query, actions }: {
  cols: Col<R>[]; rows: R[]; rowKey: (r: R) => string | number; search?: (r: R) => string; expand?: (r: R) => ReactNode;
  pageSize?: number; toolbar?: ReactNode; initialSort?: { key: string; dir: 1 | -1 }; name: string; empty?: string; query?: string;
  /** The row's ⋯ menu. */
  actions?: (r: R) => RowAction[];
}) {
  // Search, sort and page live in the address, so Back returns to the same spot in the table.
  const uk = keyFor(name);
  const [own, setQ] = useUrlState(`${uk}-q`, "");
  const q = query ?? own;
  const [sortRaw, setSortRaw] = useUrlState(`${uk}-sort`, initialSort ? `${initialSort.key}${initialSort.dir === -1 ? "-1" : ".1"}` : "");
  const sort = sortRaw ? { key: sortRaw.replace(/[.-]1$/, ""), dir: (sortRaw.endsWith("-1") ? -1 : 1) as 1 | -1 } : null;
  const setSort = (x: { key: string; dir: 1 | -1 } | null) => setSortRaw(x ? `${x.key}${x.dir === -1 ? "-1" : ".1"}` : "");
  const [hidden, toggleCol] = useHiddenCols(name, cols.filter((c) => c.hidden).map((c) => c.key));
  const [pg1, setPg1] = useUrlState(`${uk}-pg`, 1);
  const page = Math.max(0, pg1 - 1), setPage = (n: number) => setPg1(n + 1);
  const [chosen, setSize] = usePageSize();
  const pageSize = fixed ?? chosen;
  const [openRows, setOpenRows] = useState<Set<string | number>>(new Set());
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
  const firstQuery = useRef(query);
  useEffect(() => { if (query !== firstQuery.current) { firstQuery.current = query; setPage(0); } }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const pg = clampPage(page, list.length, pageSize);
  const view = list.slice(pg * pageSize, pg * pageSize + pageSize);
  // Exports carry the columns on screen, as plain values.
  const out = shown.filter((c) => c.label);
  const cells = (l: R[]) => l.map((r) => out.map((c) => (c.csv ? c.csv(r) : c.value(r))));
  return (
    <div className="ttable">
      <div className="ttool">
        {query === undefined && <input type="search" placeholder="Search" value={own} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label={`Search ${name}`} className="search" />}
        {toolbar}
        <span className="spacer" />
        <ColumnsMenu cols={cols.map((c) => ({ key: c.key, label: c.label, fixed: c.sticky }))} hidden={hidden} toggle={toggleCol} />
        <ExportMenu name={name} header={out.map((c) => c.label)} rows={() => cells(list)} page={list.length > view.length ? () => cells(view) : undefined} />
      </div>
      <div className="tbl"><table className="tt">
        <thead><tr>
          {expand && <th style={{ width: 28 }} />}
          {shown.map((c) => (
            <th key={c.key} className={c.num ? "n" : ""} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
{c.label ?               <button type="button" className="sortbtn" onClick={() => { setSort(nextSort(sort, c.key)); setPage(0); }}>
                {c.label}<span className="sorti">{sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
              </button> : null}{c.tip}
            </th>
          ))}
          {actions && <th style={{ width: 44 }} aria-label="Actions" />}
        </tr></thead>
        <tbody>
          {!view.length && <tr><td colSpan={shown.length + (expand ? 1 : 0) + (actions ? 1 : 0)} className="muted" style={{ textAlign: "center", padding: 20 }}>{empty}</td></tr>}
          {view.map((r) => {
            const key = rowKey(r), isOpen = openRows.has(key);
            return [
              <tr key={key} className={isOpen ? "open" : ""}>
                {expand && <td><button type="button" className="exp" aria-expanded={isOpen} aria-label="Show details"
                  onClick={() => { const n = new Set(openRows); if (isOpen) n.delete(key); else n.add(key); setOpenRows(n); }}>{isOpen ? "▾" : "▸"}</button></td>}
                {shown.map((c) => <td key={c.key} className={c.num ? "n" : ""}>{c.render ? c.render(r) : c.person ? <Person name={String(c.value(r) ?? "")} /> : c.value(r) ?? "—"}</td>)}
                {actions && <td className="tdact"><RowMenu actions={actions(r)} /></td>}
              </tr>,
              isOpen && expand ? <tr key={`${key}-x`} className="xrow"><td colSpan={shown.length + 1 + (actions ? 1 : 0)}>{expand(r)}</td></tr> : null,
            ];
          })}
        </tbody>
      </table></div>
      <Pager page={pg} total={list.length} size={pageSize} setPage={setPage} setSize={fixed ? undefined : setSize} />
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
