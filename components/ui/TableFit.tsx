"use client";
// Keeps every table inside its column, so no page scrolls sideways. A table that would be wider than the space it has
// switches to cards: one card per row, each value with its column name ("label  value"). It switches back as soon
// as the full table fits again (a wider window, fewer columns).
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

function fit() {
  document.querySelectorAll<HTMLElement>(".tbl").forEach((wrap) => {
    const t = wrap.querySelector<HTMLTableElement>(":scope > table");
    if (!t) return;
    const was = wrap.classList.contains("cards");
    if (was) wrap.classList.remove("cards"); // measure the full table; nothing paints in between
    const over = t.offsetWidth > wrap.clientWidth + 1;
    if (over) { label(t); wrap.classList.add("cards"); }
    else if (was) wrap.classList.remove("cards");
  });
}

export default function TableFit() {
  useEffect(() => {
    let raf = 0;
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fit(); }); };
    const ro = new ResizeObserver(later);
    ro.observe(document.body);
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true });
    later();
    return () => { ro.disconnect(); mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
