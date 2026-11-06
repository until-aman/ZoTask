"use client";
// Keeps every table inside its column, so no page scrolls sideways. A table that would be wider than the space it has
// switches to cards: one card per row, each value with its column name ("label  value"). It switches back as soon
// as the full table fits again (a wider window, fewer columns).
//
// Measuring a table means laying it out in full, which is slow for big tables, so it is done only when that table's
// rows or columns change. A resize compares the remembered full width with the new space, without measuring again.
// Popups, menus and other small changes elsewhere on the page never trigger any work.
import { useEffect } from "react";

const headText = (th: Element) => ((th.querySelector(".sortbtn") ?? th).textContent ?? "").replace(/[↕▲▼]/g, "").trim();

/** Names each cell after its column, for the card layout. Cells that already carry a name keep it. */
function label(t: HTMLTableElement) {
  const heads = Array.from(t.querySelectorAll(":scope > thead th")).map(headText);
  t.querySelectorAll(":scope > tbody > tr").forEach((tr) => {
    if (tr.children.length !== heads.length) return; // expanded detail rows and empty-state rows
    Array.from(tr.children).forEach((td, i) => { if (!td.hasAttribute("data-label") && heads[i]) td.setAttribute("data-label", heads[i]); });
  });
}

const full = new WeakMap<HTMLElement, number>(); // the narrowest each table can be when shown in full

function apply(wrap: HTMLElement) {
  const t = wrap.querySelector<HTMLTableElement>(":scope > table");
  const w = full.get(wrap);
  if (!t || w === undefined) return;
  const over = w > wrap.clientWidth + 1;
  if (over) label(t);
  if (over !== wrap.classList.contains("cards")) wrap.classList.toggle("cards", over);
}

function measure(wrap: HTMLElement) {
  const t = wrap.querySelector<HTMLTableElement>(":scope > table");
  if (!t) return;
  const was = wrap.classList.contains("cards");
  if (was) wrap.classList.remove("cards"); // measure the full table; nothing paints in between
  const keep = t.style.width;
  t.style.width = "1px"; // a table never shrinks below its content, so this reads the narrowest it can be
  full.set(wrap, t.offsetWidth);
  t.style.width = keep;
  if (was) wrap.classList.add("cards");
  apply(wrap);
}

/** True when a change can't alter a table's shape: popups, tooltips and menus opening and closing. */
const minor = (n: Node) => n instanceof Element && (n.matches(".tip-pop,.rmenu,[role=tooltip],[role=menu]") || !!n.closest(".tip"));

export default function TableFit() {
  useEffect(() => {
    const dirty = new Set<HTMLElement>();
    const seen = new WeakSet<HTMLElement>();
    let raf = 0;
    const run = () => {
      raf = 0;
      document.querySelectorAll<HTMLElement>(".tbl").forEach((w) => { if (!seen.has(w)) { seen.add(w); ro.observe(w); dirty.add(w); } });
      dirty.forEach((w) => { if (w.isConnected) measure(w); });
      dirty.clear();
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(run); };
    const ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target as HTMLElement)));
    const mo = new MutationObserver((list) => {
      let any = false;
      for (const m of list) {
        if (minor(m.target) || ([...m.addedNodes, ...m.removedNodes].length && [...m.addedNodes, ...m.removedNodes].every(minor))) continue;
        const wrap = m.target instanceof Element ? m.target.closest<HTMLElement>(".tbl") : null;
        if (wrap) dirty.add(wrap);
        any = true; // a new table may have arrived
      }
      if (any) later();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    later();
    document.fonts?.ready.then(() => { document.querySelectorAll<HTMLElement>(".tbl").forEach((w) => dirty.add(w)); later(); });
    return () => { ro.disconnect(); mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
