"use client";
import { useEffect, useRef, useState } from "react";

/** Small "i" button that shows an explanation on click. Safe inside links: it never triggers them. */
export default function InfoTip({ title, rows, note, children, label = "What does this mean?" }: {
  title?: string; rows?: [string, React.ReactNode][]; note?: React.ReactNode; children?: React.ReactNode; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="tip" ref={ref}>
      <button type="button" className="tip-btn" aria-label={label} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}>i</button>
      {open && <span className="tip-pop" role="tooltip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        {title && <span className="tip-title">{title}</span>}
        {rows && <span className="tip-rows">{rows.map(([k, v]) => <span key={k} className="tip-row"><b>{k}</b><span>{v}</span></span>)}</span>}
        {children}
        {note && <span className="tip-note">{note}</span>}
      </span>}
    </span>
  );
}
