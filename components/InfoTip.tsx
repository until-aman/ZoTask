"use client";
import { useEffect, useRef, useState } from "react";

/** Small "i" button that shows an explanation on click. Safe inside links: it never triggers them. */
export default function InfoTip({ title, rows, note, children, label = "What does this mean?" }: {
  title?: string; rows?: [string, React.ReactNode][]; note?: React.ReactNode; children?: React.ReactNode; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const me = useRef({});
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // Fixed position so table scroll areas and cards never clip it; close on scroll instead of drifting.
    const off = () => setOpen(false);
    // Only one popup at a time: another tip opening closes this one (clicks on tips don't bubble to the document).
    const other = (e: Event) => { if ((e as CustomEvent).detail !== me.current) setOpen(false); };
    window.addEventListener("infotip-open", other);
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", off, true);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", off, true); window.removeEventListener("infotip-open", other); };
  }, [open]);
  return (
    <span className="tip" ref={ref} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="tip-btn" aria-label={label} aria-expanded={open}
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect(), w = Math.min(300, window.innerWidth * 0.8);
          const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - w - 8));
          setPos(r.bottom + 240 > window.innerHeight ? { bottom: window.innerHeight - r.top + 6, left } : { top: r.bottom + 6, left });
          if (!open) window.dispatchEvent(new CustomEvent("infotip-open", { detail: me.current }));
          setOpen(!open);
        }}>i</button>
      {open && <span className="tip-pop" role="tooltip" style={pos ? { position: "fixed", top: pos.top ?? "auto", bottom: pos.bottom ?? "auto", left: pos.left } : undefined} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        {title && <span className="tip-title">{title}</span>}
        {rows && <span className="tip-rows">{rows.map(([k, v]) => <span key={k} className="tip-row"><b>{k}</b><span>{v}</span></span>)}</span>}
        {children}
        {note && <span className="tip-note">{note}</span>}
      </span>}
    </span>
  );
}
