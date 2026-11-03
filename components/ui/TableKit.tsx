"use client";
// The pieces every table shares, so all lists look and work the same:
// a Columns picker, an Export menu (CSV or Excel, this page or all rows), initials avatars and a ⋯ menu per row.
import { ReactNode, useEffect, useRef, useState } from "react";
import { csv, xlsx } from "@/lib/xlsx-write";

type Cell = string | number | null | undefined;

/** Closes a popup on an outside click or Escape. */
function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !e.composedPath().includes(ref.current)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

const Ico = ({ d }: { d: string }) => <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const COLS_I = "M3.5 4h13v12h-13zM8 4v12M12.5 4v12";
const EXPORT_I = "M10 3v9M6.5 8.5L10 12l3.5-3.5M4 14.5v2h12v-2";
const CHEV_I = "M6 8l4 4 4-4";

/** Hidden columns for one table, remembered in this browser. Columns marked `hidden` start hidden. */
export function useHiddenCols(table: string, startHidden: string[] = []): [Set<string>, (key: string) => void] {
  const key = `zotask.cols.${table}`;
  const [hidden, set] = useState<Set<string>>(() => new Set(startHidden));
  useEffect(() => { try { const v = localStorage.getItem(key); if (v) set(new Set(JSON.parse(v))); } catch { /* storage blocked */ } }, [key]);
  const toggle = (k: string) => set((h) => {
    const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem(key, JSON.stringify([...n])); } catch { /* storage blocked */ }
    return n;
  });
  return [hidden, toggle];
}

/** "Columns" button with a checkbox per column. Columns marked `fixed` can't be hidden. */
export function ColumnsMenu({ cols, hidden, toggle }: { cols: { key: string; label: string; fixed?: boolean }[]; hidden: Set<string>; toggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLSpanElement>(open, () => setOpen(false));
  return (
    <span className="tkwrap" ref={ref}>
      <button type="button" className="btn sm tkbtn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true"><Ico d={COLS_I} />Columns</button>
      {open && (
        <div className="pop right tkpop" role="group" aria-label="Show columns">
          {cols.filter((c) => c.label).map((c) => (
            <label key={c.key} className="opt"><input type="checkbox" checked={!hidden.has(c.key)} disabled={c.fixed} onChange={() => toggle(c.key)} />{c.label}</label>
          ))}
        </div>
      )}
    </span>
  );
}

function download(blob: Blob, file: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** "Export ▾": CSV or Excel, for the rows on this page or every row that matches the filters. */
export function ExportMenu({ name, header, rows, page }: { name: string; header: string[]; rows: () => Cell[][]; page?: () => Cell[][] }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLSpanElement>(open, () => setOpen(false));
  const file = `${name.toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "")}-${new Date().toISOString().slice(0, 10)}`;
  const go = (kind: "csv" | "xlsx", which: "all" | "page") => {
    const data = [header, ...(which === "page" && page ? page() : rows())];
    download(kind === "csv" ? new Blob(["﻿" + csv(data)], { type: "text/csv;charset=utf-8" }) : xlsx(data, name), `${file}.${kind}`);
    setOpen(false);
  };
  return (
    <span className="tkwrap" ref={ref}>
      <button type="button" className="btn sm tkbtn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"><Ico d={EXPORT_I} />Export<Ico d={CHEV_I} /></button>
      {open && (
        <div className="pop right tkpop tkmenu" role="menu" aria-label="Export">
          <div className="tkh">All {rows().length} rows</div>
          <button type="button" role="menuitem" onClick={() => go("xlsx", "all")}>Excel (.xlsx)</button>
          <button type="button" role="menuitem" onClick={() => go("csv", "all")}>CSV</button>
          {page && <>
            <div className="tkh">This page only</div>
            <button type="button" role="menuitem" onClick={() => go("xlsx", "page")}>Excel (.xlsx)</button>
            <button type="button" role="menuitem" onClick={() => go("csv", "page")}>CSV</button>
          </>}
        </div>
      )}
    </span>
  );
}

const TONES = ["#635bff", "#0a47b0", "#12a3b4", "#e0571e", "#a3123a", "#1f9e3a", "#7a5af8", "#d97917"];
/** Initials in a coloured circle; the same name always gets the same colour. */
export function Avatar({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  const n = (name ?? "").trim();
  if (!n || /^unassigned$/i.test(n) || n === "—") return <span className="av none" style={{ width: size, height: size }} aria-hidden="true">?</span>;
  const parts = n.split(/\s+/).filter((p) => /\w/.test(p));
  const ini = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <span className="av" style={{ width: size, height: size, background: TONES[h % TONES.length], fontSize: size * 0.4 }} aria-hidden="true">{ini}</span>;
}
/** A name with its avatar, and an optional second line. */
export function Person({ name, sub }: { name: string | null | undefined; sub?: ReactNode }) {
  return <span className="person"><Avatar name={name} /><span className="person-t"><span>{name || "Unassigned"}</span>{sub ? <small>{sub}</small> : null}</span></span>;
}

export type RowAction = { label: string; onClick: () => unknown; danger?: boolean; confirm?: string; hidden?: boolean };
/** ⋯ at the end of a row with that row's actions. A `confirm` action asks inside the menu before it runs. */
export function RowMenu({ actions, label = "Row actions" }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<RowAction | null>(null);
  const close = () => { setOpen(false); setAsk(null); };
  const ref = useOutside<HTMLSpanElement>(open, close);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const list = actions.filter((a) => !a.hidden);
  // The menu is placed against the window, so a scrolling table can't clip it; it opens upwards near the bottom.
  useEffect(() => {
    if (!open) return;
    const away = () => close();
    window.addEventListener("scroll", away, true); window.addEventListener("resize", away);
    return () => { window.removeEventListener("scroll", away, true); window.removeEventListener("resize", away); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open) return close();
    const r = e.currentTarget.getBoundingClientRect(), up = window.innerHeight - r.bottom < 40 * list.length + 40;
    setPos({ right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    setOpen(true);
  };
  if (!list.length) return null;
  return (
    <span className="tkwrap rowmenu" ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="dots" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={label} title="Actions">⋯</button>
      {open && (
        <div className="pop right tkpop tkmenu fixed" role="menu" aria-label={label} style={pos}>
          {ask ? <>
            <div className="tkh">{ask.confirm}</div>
            <div className="row2" style={{ padding: "4px 8px 6px" }}>
              <button type="button" className="btn sm danger" onClick={() => { void ask.onClick(); close(); }}>Yes</button>
              <button type="button" className="btn sm" onClick={() => setAsk(null)}>No</button>
            </div>
          </> : list.map((a) => (
            <button key={a.label} type="button" role="menuitem" className={a.danger ? "t-r" : ""} onClick={() => { if (a.confirm) setAsk(a); else { void a.onClick(); close(); } }}>{a.label}</button>
          ))}
        </div>
      )}
    </span>
  );
}
