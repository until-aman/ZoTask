"use client";
// Left menu: search, then screens and folding groups. On phones it becomes a scrolling row under the brand.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const I = (d: string) => <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const ICONS: Record<string, React.ReactNode> = {
  "/tasks": I("M4 5.5l1.5 1.5L8 4.5M10.5 6H16M4 10.5l1.5 1.5L8 9.5M10.5 11H16M4 15.5h.01M10.5 16H16"),
  "/queue": I("M3 4.5h14v11H3zM3 9h4l1 2h4l1-2h4"),
  "/dashboard": I("M3 16.5h14M5 13.5V9M9 13.5V5M13 13.5v-6M17 13.5V10"),
  "/compare": I("M7 3.5v13M13 3.5v13M3.5 7H7M13 13h3.5M3.5 13H7M13 7h3.5"),
  "/escalations": I("M10 3l7.5 13h-15zM10 8.5v3.5M10 14.3h.01"),
  "/map": I("M10 17.5s5.5-5 5.5-9.5a5.5 5.5 0 0 0-11 0c0 4.5 5.5 9.5 5.5 9.5zM10 10a2 2 0 1 0 0-4a2 2 0 0 0 0 4z"),
  "/admin": I("M10 7a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"),
};

export type NavItem = { href: string; label: string; icon?: string; children?: { href: string; label: string }[] };
const OPEN_KEY = "zt-nav-open";
const Chev = ({ open }: { open: boolean }) => <svg className="nchev" width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><path d={open ? "M5 12.5l5-5 5 5" : "M5 7.5l5 5 5-5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Left menu: a search box, then screens and groups that fold open. On phones it becomes a scrolling row under the brand. */
export default function Nav({ links }: { links: NavItem[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}")); } catch { /* storage blocked */ } }, []);
  const toggle = (k: string) => setOpen((o) => { const n = { ...o, [k]: !isOpen(k) }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  // On phones the menu is a bar across the top; sticky table headers sit just under it.
  useEffect(() => {
    const side = document.querySelector<HTMLElement>(".side");
    if (!side) return;
    const set = () => document.documentElement.style.setProperty("--sideh", `${side.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(side);
    return () => ro.disconnect();
  }, []);

  // A sub-item is current when its path matches and, for links with ?tab=, the tab does too.
  const here = (href: string) => {
    const [p, qs] = href.split("?");
    if (!path.startsWith(p)) return false;
    const want = new URLSearchParams(qs ?? "").get("tab"), have = sp.get("tab");
    return p === "/admin" ? (want ?? "tasks") === (have ?? "tasks") : true;
  };
  const groupHere = (g: NavItem) => !!g.children?.some((c) => here(c.href));
  const isOpen = (k: string) => open[k] ?? groupHere(links.find((l) => l.label === k)!);
  const needle = q.trim().toLowerCase();
  const hit = (s: string) => !needle || s.toLowerCase().includes(needle);
  const shown = links.map((l) => ({ ...l, kids: l.children?.filter((c) => hit(c.label) || hit(l.label)) }))
    .filter((l) => hit(l.label) || (l.kids && l.kids.length));
  const first = shown[0] ? (shown[0].kids?.[0]?.href ?? shown[0].href) : null;

  return (
    <>
      <label className="nsearch">
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 15.5a6.5 6.5 0 1 0 0-13a6.5 6.5 0 0 0 0 13zM17.5 17.5l-3.8-3.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        <input type="search" placeholder="Search menu…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search menu"
          onKeyDown={(e) => { if (e.key === "Enter" && first) { router.push(first); setQ(""); } if (e.key === "Escape") setQ(""); }} />
      </label>
      <nav className="nav" aria-label="ZoTask">
        {shown.map((l) => {
          const icon = ICONS[l.icon ?? l.href];
          if (!l.children) {
            const on = here(l.href);
            return <Link key={l.label} href={l.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined} title={l.label}>{icon}<span>{l.label}</span></Link>;
          }
          const on = groupHere(l), exp = needle ? true : isOpen(l.label);
          return (
            <div key={l.label} className={`ngrp${exp ? " open" : ""}`}>
              {/* The group row folds the group; in the icon rail and on phones it goes to the group's first screen instead. */}
              <button type="button" className={`nhead${on ? " in" : ""}`} aria-expanded={exp} onClick={() => toggle(l.label)} title={l.label}>{icon}<span>{l.label}</span><Chev open={exp} /></button>
              <Link href={l.children[0].href} className={`nlink${on ? " on" : ""}`} title={l.label} tabIndex={-1} aria-hidden="true">{icon}<span>{l.label}</span></Link>
              {exp && (
                <div className="nsub">
                  {(l.kids ?? l.children).map((c) => {
                    const cur = here(c.href);
                    return <Link key={c.href} href={c.href} className={cur ? "on" : ""} aria-current={cur ? "page" : undefined}><span>{c.label}</span></Link>;
                  })}
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <div className="nnone">Nothing matches “{q}”</div>}
      </nav>
    </>
  );
}
