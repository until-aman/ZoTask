"use client";
// Left menu: one row per screen, icon then name. On phones it becomes a scrolling row under the brand.
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function Nav({ links }: { links: [string, string][] }) {
  const path = usePathname();
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
  return (
    <nav className="nav" aria-label="ZoTask">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? "on" : ""} aria-current={path.startsWith(href) ? "page" : undefined}>{ICONS[href]}<span>{label}</span></Link>
      ))}
    </nav>
  );
}
