"use client";
// State kept in the address bar, so Back (or a reload, or a shared link) lands on exactly the same view:
// the same tab, filters, search, sort and page. Only values that differ from the default are written,
// and they replace the current history entry, so changing a filter doesn't add steps to Back.
import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

type V = string | number | boolean | string[];

function parse<T extends V>(raw: string | null, def: T): T {
  if (raw === null) return def;
  if (typeof def === "number") { const n = Number(raw); return (Number.isFinite(n) ? n : def) as T; }
  if (typeof def === "boolean") return (raw === "1") as T;
  if (Array.isArray(def)) return (raw ? raw.split("~") : []) as T;
  return raw as T;
}
const same = (a: V, b: V) => (Array.isArray(a) && Array.isArray(b) ? a.join("~") === b.join("~") : a === b);
const text = (v: V) => (Array.isArray(v) ? v.join("~") : typeof v === "boolean" ? (v ? "1" : "0") : String(v));

// Writes made in the same moment (a filter change that also resets the page) are merged and applied together,
// so one can't undo another.
let pending: Record<string, string | null> = {};
let queued = false;

/** Writes several keys at once into the current address, without a new history step. */
export function writeUrl(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  Object.assign(pending, patch);
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    const p = pending; pending = {};
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(p)) { if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, v); }
    const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "") + u.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", next);
  }, 0);
}

/** Like useState, but read from and written to the address bar under `key`. */
export function useUrlState(key: string, def: string): [string, (v: string) => void];
export function useUrlState(key: string, def: number): [number, (v: number) => void];
export function useUrlState(key: string, def: boolean): [boolean, (v: boolean) => void];
export function useUrlState(key: string, def: string[]): [string[], (v: string[]) => void];
export function useUrlState<T extends V>(key: string, def: T): [T, (v: T) => void] {
  const sp = useSearchParams();
  const [v, setV] = useState<T>(() => parse(sp?.get(key) ?? null, def));
  const set = useCallback((x: T) => {
    setV(x);
    writeUrl({ [key]: same(x, def) ? null : text(x) });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, set];
}

/** A short, address-safe key from a table name, e.g. "Task setup" → "task-setup". */
export const keyFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

type Sort = { key: string; dir: 1 | -1 } | null;
/** A table sort kept in the address as "key-1" (newest/largest first) or "key.1". */
export function useUrlSort(key: string, def: Sort = null): [Sort, (s: Sort) => void] {
  const enc = (s: Sort) => (s ? `${s.key}${s.dir === -1 ? "-1" : ".1"}` : "");
  const [raw, setRaw] = useUrlState(key, enc(def));
  const s: Sort = raw ? { key: raw.replace(/[.-]1$/, ""), dir: raw.endsWith("-1") ? -1 : 1 } : null;
  return [s, (x: Sort) => setRaw(enc(x))];
}

/** A page number kept in the address counting from 1, used as 0-based like the pagers expect. */
export function useUrlPage(key: string): [number, (n: number) => void] {
  const [p, setP] = useUrlState(key, 1);
  return [Math.max(0, p - 1), (n: number) => setP(n + 1)];
}

/** Whether the address already carries any of these keys (then a saved default view shouldn't override it). */
export const urlHas = (keys: string[]) => typeof window !== "undefined" && keys.some((k) => new URLSearchParams(window.location.search).has(k));
