"use client";
// The page toolbar every list screen shares: search, one Filters button that opens all filters, saved filters,
// and the active filters as removable chips. Also the stat cards above it, the pager and header sorting below it.
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteView, saveView, setDefaultView } from "@/app/actions";
import type { SavedView } from "@/lib/views";

export type { SavedView };
export type ActiveChip = { key: string; label: ReactNode; clear: () => void };

/** JSON with sorted keys and empty values dropped, so two filter sets compare equal regardless of order. */
export function sameFilters(a: object, b: object) {
  const norm = (o: object): string => JSON.stringify(Object.entries(o).filter(([, v]) => v !== "" && v !== false && v !== null && v !== undefined && !(Array.isArray(v) && !v.length))
    .sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]));
  return norm(a) === norm(b);
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    // composedPath, not contains(): a click can remove its own target (a picked option) before this runs.
    const click = (e: MouseEvent) => { const path = e.composedPath(); if (ref.current && !path.includes(ref.current) && !path.some((n) => n instanceof HTMLElement && n.classList.contains("modal"))) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

export type Saved = {
  page: string; views: SavedView[]; current: object; apply: (f: Record<string, unknown>) => void;
  /** Suggested name for a new saved filter. */
  name?: string; note?: string; notify?: (msg: string) => void;
};

export function FilterBar({ search, setSearch, searchLabel = "Search", chips = [], panel, foot, onClearAll, saved, right, dates, datesRight }: {
  search?: string; setSearch?: (q: string) => void; searchLabel?: string; chips?: ActiveChip[];
  /** Date quick filters, shown on their own row under the search. */
  dates?: ReactNode;
  /** Put the dates at the right end of the search row, with a wide search box. */
  datesRight?: boolean;
  /** The filters, shown when the Filters button is pressed. */
  panel: ReactNode;
  /** Footer of the filters panel; defaults to a Done button. Gets close() to call after applying. */
  foot?: (close: () => void) => ReactNode;
  onClearAll?: () => void; saved?: Saved; right?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);
  const ref = useOutside(open, close);
  return (
    <section className="fbar2" aria-label="Search and filters">
      <div className="fbrow">
        {setSearch && <input type="search" className={`search${datesRight ? " grow" : ""}`} placeholder={searchLabel} value={search ?? ""} onChange={(e) => setSearch(e.target.value)} aria-label={searchLabel} />}
        <span className="fwrap" ref={ref}>
          <button type="button" className={`filtbtn${chips.length ? " set" : ""}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12M4.5 8h7M7 12.5h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>
            Filters{chips.length ? <span className="fcount">{chips.length}</span> : null}
          </button>
          {open && (
            <div className="fpanel" role="dialog" aria-label="Filters">
              <div className="fpanel-b">{panel}</div>
              <div className="fpanel-f">
                {onClearAll && chips.length > 0 ? <button type="button" className="link" onClick={onClearAll}>Clear all</button> : <span />}
                {foot ? foot(close) : <button type="button" className="btn primary sm" onClick={close}>Done</button>}
              </div>
            </div>
          )}
        </span>
        {saved && <SavedViews {...saved} />}
        {right && <><span className="spacer" />{right}</>}
        {datesRight && dates && <span className="fdates">{dates}</span>}
      </div>
      {!datesRight && dates}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => <span key={c.key} className="chip">{c.label}<button type="button" aria-label="Remove filter" onClick={c.clear}>×</button></span>)}
          {onClearAll && <button type="button" className="link small" onClick={onClearAll}>Clear all</button>}
        </div>
      )}
    </section>
  );
}

/** Saved filters sit next to the Filters button, one click each. The star marks the one the page opens with. */
function SavedViews({ page, views, current, apply, name = "", note, notify }: Saved) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [manage, setManage] = useState(false);
  const close = useMemo(() => () => setManage(false), []);
  const ref = useOutside(manage, close);
  const active = views.find((v) => sameFilters(v.f, current));
  const say = (m: string) => notify?.(m);
  return (
    <div className="saved" aria-label="Saved filters">
      <span className="saved-l">Saved</span>
      {views.map((v) => (
        <button key={v.id} type="button" className="svchip" aria-pressed={active?.id === v.id} onClick={() => apply(v.f)} title={v.def ? "Opens by default" : "Apply these filters"}>
          {v.def && <span className="star" aria-label="default">★</span>}{v.name}
        </button>
      ))}
      {!active && <button type="button" className="svadd" onClick={() => setSaving(true)}>+ Save filters</button>}
      {views.length > 0 && (
        <span className="fwrap" ref={ref}>
          <button type="button" className="link small" onClick={() => setManage(!manage)} aria-expanded={manage}>Manage</button>
          {manage && (
            <div className="pop right svman" role="dialog" aria-label="Manage saved filters">
              {views.map((v) => (
                <div key={v.id} className="svrow">
                  <span className="ell">{v.name}</span>
                  <button type="button" className={`link small${v.def ? " on" : ""}`} title={v.def ? "Stop opening with this" : "Open this page with it"}
                    onClick={async () => { const r = await setDefaultView(v.id, !v.def); say(r.ok ? r.msg ?? "" : r.error); router.refresh(); }}>{v.def ? "★ Default" : "☆ Make default"}</button>
                  <button type="button" className="link small t-r" onClick={async () => { const r = await deleteView(v.id); say(r.ok ? `Deleted “${v.name}”` : r.error); router.refresh(); }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </span>
      )}
      {saving && <SaveModal page={page} current={current} name={name} note={note} close={() => setSaving(false)} done={(m) => { setSaving(false); say(m); router.refresh(); }} />}
    </div>
  );
}

function SaveModal({ page, current, name: suggested, note, close, done }: { page: string; current: object; name: string; note?: string; close: () => void; done: (msg: string) => void }) {
  const [name, setName] = useState(suggested);
  const [def, setDef] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="mcard" role="dialog" aria-label="Save filters">
        <h2>Save these filters</h2>
        {note && <div className="info" style={{ background: "var(--bg)", borderRadius: 8, padding: "8px 10px" }}>{note}</div>}
        <label className="f">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} /></label>
        <label className="row2" style={{ fontWeight: 600 }}><input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} /> Open this page with these filters</label>
        {err && <p className="err">{err}</p>}
        <div className="row2"><span className="spacer" /><button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={async () => { const r = await saveView(page, name.trim(), current, def); if (r.ok) done(r.msg ?? "Saved"); else setErr(r.error); }}>Save</button></div>
      </div>
    </div>
  );
}

/** Headline counts above a list. A card with onClick works as a quick filter. */
export type Stat = { key: string; label: string; value: ReactNode; sub?: ReactNode; tone?: "r" | "a" | "g"; active?: boolean; onClick?: () => void; tip?: ReactNode };
export function Stats({ items, compact }: { items: Stat[]; compact?: boolean }) {
  return (
    <div className={`stats${compact ? " sm" : ""}`}>
      {items.map((s) => {
        const body = <><span className="stat-h"><b className={s.tone ? `t-${s.tone}` : ""}>{s.value}</b><span className="stat-l">{s.label}{s.tip}</span></span>{s.sub !== undefined && <span className="stat-s">{s.sub}</span>}</>;
        return s.onClick
          ? <button key={s.key} type="button" className={`stat click${s.tone ? ` ${s.tone}` : ""}`} aria-pressed={!!s.active} onClick={s.onClick}>{body}</button>
          : <div key={s.key} className={`stat${s.tone ? ` ${s.tone}` : ""}`}>{body}</div>;
      })}
    </div>
  );
}

export const PAGE = 20;
export const PAGE_SIZES = [10, 20, 25, 50];
const SIZE_KEY = "zotask.rows";
/** Rows per page, one choice for the whole app, remembered in this browser. */
export function usePageSize(): [number, (n: number) => void] {
  const [size, set] = useState(PAGE);
  useEffect(() => {
    try { const n = Number(localStorage.getItem(SIZE_KEY)); if (PAGE_SIZES.includes(n)) set(n); } catch { /* storage blocked */ }
    const on = (e: Event) => set((e as CustomEvent<number>).detail);
    window.addEventListener(SIZE_KEY, on);
    return () => window.removeEventListener(SIZE_KEY, on);
  }, []);
  const change = (n: number) => {
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* storage blocked */ }
    window.dispatchEvent(new CustomEvent(SIZE_KEY, { detail: n }));
  };
  return [size, change];
}
/** The page that fits `total` rows; use it so the list can never sit before the first page or past the last. */
export const clampPage = (page: number, total: number, size: number) => Math.max(0, Math.min(page, Math.ceil(total / size) - 1));

/** Sticky footer under a list: rows per page, where you are, and first/previous/next/last buttons. */
export function Pager({ page, total, size = PAGE, setPage, setSize }: { page: number; total: number; size?: number; setPage: (p: number) => void; setSize?: (n: number) => void }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = clampPage(page, total, size);
  const go = (n: number) => setPage(Math.max(0, Math.min(pages - 1, n)));
  const sizes = !!setSize && total > PAGE_SIZES[0];
  return (
    <div className={`pager${sizes || pages > 1 ? "" : " plain"}`} role="navigation" aria-label="Pages">
      {sizes && <label className="pgsize">Rows<select value={size} onChange={(e) => { const n = Number(e.target.value); setSize(n); setPage(Math.floor((p * size) / n)); }} aria-label="Rows per page">
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      <span className="pgcount">{total <= size ? `${total} ${total === 1 ? "row" : "rows"}` : `${p * size + 1}–${Math.min(total, (p + 1) * size)} of ${total}`}</span>
      {pages > 1 && <span className="pgbtns">
        <button type="button" className="btn sm" disabled={p === 0} onClick={() => go(0)} aria-label="First page" title="First page">«</button>
        <button type="button" className="btn sm" disabled={p === 0} onClick={() => go(p - 1)} aria-label="Previous page" title="Previous page">‹</button>
        <span className="pgnum">Page {p + 1} of {pages}</span>
        <button type="button" className="btn sm" disabled={p >= pages - 1} onClick={() => go(p + 1)} aria-label="Next page" title="Next page">›</button>
        <button type="button" className="btn sm" disabled={p >= pages - 1} onClick={() => go(pages - 1)} aria-label="Last page" title="Last page">»</button>
      </span>}
    </div>
  );
}

export type SortState = { key: string; dir: 1 | -1 } | null;
/** Click a header to sort, highest first; click again for lowest first. */
export const nextSort = (cur: SortState, key: string): SortState => (cur?.key === key ? { key, dir: cur.dir === -1 ? 1 : -1 } : { key, dir: -1 });
export function sortRows<R>(rows: R[], sort: SortState, value: (r: R, key: string) => number | string | null | undefined) {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key);
    if ((x === null || x === undefined) && (y === null || y === undefined)) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
}
export function SortHead({ k, label, sort, setSort, className = "" }: { k: string; label: string; sort: SortState; setSort: (s: SortState) => void; className?: string }) {
  const on = sort?.key === k;
  return (
    <span className={`sorth ${className}`} aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="sortbtn" onClick={() => setSort(nextSort(sort, k))}>{label}<span className="sorti">{on ? (sort!.dir === 1 ? "▲" : "▼") : "↕"}</span></button>
    </span>
  );
}

export const DATE_PRESETS: [string, string][] = [["today", "Today"], ["yday", "Yesterday"], ["7d", "Last 7 days"], ["custom", "Custom"]];
/** Date quick filters under the search. Presets apply at once; Custom opens a From/To pair (or one date with `single`) and applies on Apply. */
export function DateRow({ label = "Dates", presets = DATE_PRESETS, value, from = "", to = "", onPick, onCustom, single, max }: {
  label?: string; presets?: [string, string][]; value: string; from?: string; to?: string;
  onPick: (key: string) => void; onCustom: (from: string, to: string) => void; single?: boolean; max?: string;
}) {
  const [custom, setCustom] = useState(value === "custom");
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  useEffect(() => { setCustom(value === "custom"); setF(from); setT(to); }, [value, from, to]);
  const ok = single ? !!f : !!f && !!t && f <= t;
  const changed = value !== "custom" || f !== from || (!single && t !== to);
  return (
    <div className="daterow" role="group" aria-label={label}>
      <span className="ff-l">{label}</span>
      <div className="seg">{presets.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={k === "custom" ? custom : !custom && value === k}
          onClick={() => { if (k === "custom") setCustom(true); else { setCustom(false); onPick(k); } }}>{l}</button>
      ))}</div>
      {custom && <span className="dates">
        {single
          ? <input type="date" value={f} max={max} onChange={(e) => { setF(e.target.value); if (e.target.value) onCustom(e.target.value, e.target.value); }} aria-label="Date" />
          : <>
            <input type="date" value={f} max={t || max} onChange={(e) => setF(e.target.value)} aria-label="From" /><span className="muted">to</span>
            <input type="date" value={t} min={f} max={max} onChange={(e) => setT(e.target.value)} aria-label="To" />
            <button type="button" className="btn sm primary" disabled={!ok || !changed} onClick={() => onCustom(f, t)}>Apply</button>
          </>}
      </span>}
    </div>
  );
}

export type PickOpt = { v: string; label?: string; sub?: string };
/** A dropdown you can type into: type part of a name to narrow the list, then pick. With `multi`, each pick is added and the box clears. */
export function SearchPick({ options, value = "", onChange, placeholder = "Type to search", allLabel, multi, id }: {
  options: PickOpt[]; value?: string; onChange: (v: string) => void; placeholder?: string; allLabel?: string; multi?: boolean; id?: string;
}) {
  const name = (o?: PickOpt) => (o ? o.label ?? o.v : "");
  const picked = options.find((o) => o.v === value);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const close = useMemo(() => () => { setOpen(false); setText(""); }, []);
  const ref = useOutside(open, close);
  // The list is fixed to the screen so a scrolling filters panel can't clip it.
  const [box, setBox] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.querySelector("input")?.getBoundingClientRect();
      if (r) { const up = r.bottom + 270 > innerHeight && r.top > 280; setBox({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: Math.max(r.width, 220), up }); }
    };
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, ref]);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const list = options.filter((o) => words.every((w) => `${name(o)} ${o.sub ?? ""}`.toLowerCase().includes(w))).slice(0, 60);
  const pick = (v: string) => { onChange(v); close(); };
  return (
    <span className="spick" ref={ref}>
      <input type="search" id={id} role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off"
        value={open ? text : multi ? "" : name(picked)} placeholder={!multi && !picked && allLabel ? allLabel : placeholder}
        onFocus={() => { setOpen(true); setHi(0); }} onClick={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (list[hi]) pick(list[hi].v); }
          else if (e.key === "Escape" && open) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); close(); (e.target as HTMLInputElement).blur(); }
        }} />
      {!multi && picked && !open && <button type="button" className="spick-x" aria-label="Clear" onClick={() => onChange("")}>×</button>}
      {open && (
        <ul className="spick-l" role="listbox" style={box ? { top: box.top, left: Math.min(box.left, innerWidth - box.width - 8), width: box.width, transform: box.up ? "translateY(-100%)" : undefined } : { visibility: "hidden" }}>
          {!multi && allLabel && !text && <li role="option" aria-selected={!value} className={!value ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(""); }}>{allLabel}</li>}
          {list.map((o, i) => (
            <li key={o.v} role="option" aria-selected={o.v === value} className={`${i === hi ? "hi" : ""}${o.v === value ? " on" : ""}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.v); }}>
              <span>{name(o)}</span>{o.sub && <small>{o.sub}</small>}
            </li>
          ))}
          {!list.length && <li className="none">No match for “{text}”</li>}
        </ul>
      )}
    </span>
  );
}

/** A labelled control inside the filters panel. */
export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`ff${wide ? " wide" : ""}`}><span className="ff-l">{label}</span>{children}</div>;
}
