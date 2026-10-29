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
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".modal")) close(); };
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

export function FilterBar({ search, setSearch, searchLabel = "Search", chips = [], panel, foot, onClearAll, saved, right }: {
  search?: string; setSearch?: (q: string) => void; searchLabel?: string; chips?: ActiveChip[];
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
        {setSearch && <input type="search" className="search" placeholder={searchLabel} value={search ?? ""} onChange={(e) => setSearch(e.target.value)} aria-label={searchLabel} />}
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
      </div>
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
export function Stats({ items }: { items: Stat[] }) {
  return (
    <div className="stats">
      {items.map((s) => {
        const body = <><span className="stat-l">{s.label}{s.tip}</span><b className={s.tone ? `t-${s.tone}` : ""}>{s.value}</b>{s.sub !== undefined && <span className="stat-s">{s.sub}</span>}</>;
        return s.onClick
          ? <button key={s.key} type="button" className={`stat click${s.tone ? ` ${s.tone}` : ""}`} aria-pressed={!!s.active} onClick={s.onClick}>{body}</button>
          : <div key={s.key} className={`stat${s.tone ? ` ${s.tone}` : ""}`}>{body}</div>;
      })}
    </div>
  );
}

export const PAGE = 20;
export function Pager({ page, total, size = PAGE, setPage }: { page: number; total: number; size?: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return total ? <div className="pager"><span className="small muted">{total} {total === 1 ? "row" : "rows"}</span></div> : null;
  const p = Math.min(page, pages - 1);
  return (
    <div className="pager">
      <span className="small muted">{p * size + 1}–{Math.min(total, (p + 1) * size)} of {total}</span>
      <button type="button" className="btn sm" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page">‹</button>
      <span className="small">Page {p + 1} of {pages}</span>
      <button type="button" className="btn sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page">›</button>
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

/** A labelled control inside the filters panel. */
export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`ff${wide ? " wide" : ""}`}><span className="ff-l">{label}</span>{children}</div>;
}
