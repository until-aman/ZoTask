"use client";
// Hides the left menu to a thin icon rail. It also hides by itself after a minute without use, so screens get the full width.
import { useEffect, useState } from "react";

const KEY = "zt-side-mini", IDLE_MS = 60_000;

export default function SideToggle() {
  const [mini, setMini] = useState(false);
  useEffect(() => { try { if (sessionStorage.getItem(KEY) === "1") setMini(true); } catch { /* storage blocked */ } }, []);
  useEffect(() => {
    document.querySelector(".shell")?.classList.toggle("sidemin", mini);
    try { sessionStorage.setItem(KEY, mini ? "1" : "0"); } catch { /* storage blocked */ }
    if (mini) return;
    // Open: count a minute from the last time the pointer or keyboard was in the menu.
    const side = document.querySelector<HTMLElement>(".side");
    let t: ReturnType<typeof setTimeout> | undefined;
    let inside = false;
    const arm = () => { clearTimeout(t); if (!inside) t = setTimeout(() => { if (matchMedia("(min-width:901px)").matches) setMini(true); }, IDLE_MS); };
    const enter = () => { inside = true; clearTimeout(t); };
    const leave = () => { inside = false; arm(); };
    side?.addEventListener("mouseenter", enter); side?.addEventListener("mouseleave", leave);
    side?.addEventListener("focusin", enter); side?.addEventListener("focusout", leave);
    arm();
    return () => { clearTimeout(t); side?.removeEventListener("mouseenter", enter); side?.removeEventListener("mouseleave", leave); side?.removeEventListener("focusin", enter); side?.removeEventListener("focusout", leave); };
  }, [mini]);
  return (
    <button type="button" className="sidetog" onClick={() => setMini(!mini)} aria-label={mini ? "Show menu" : "Hide menu"} title={mini ? "Show menu" : "Hide menu"} aria-expanded={!mini}>
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d={mini ? "M8 5l5 5-5 5" : "M12 5l-5 5 5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}
