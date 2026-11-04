"use client";
import "@/lib/storage";
// "‹ Back" at the top of a detail page: goes back to exactly where the person came from (same tab, filters and page),
// and names that page. Opened straight from a link, it goes to the usual list instead.
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const NAMES: [RegExp, string][] = [[/^\/queue/, "Review Queue"], [/^\/tasks\/?$/, "My Tasks"], [/^\/dashboard/, "Review Dashboard"], [/^\/compare/, "Compare"],
  [/^\/escalations/, "Escalations"], [/^\/admin\/?$/, "Admin"], [/^\/map/, "Map"], [/^\/review\//, "the review sheet"], [/^\/tasks\/\d/, "the task"]];
const KEY = "tt-nav";

/** Remembers the page before this one, for BackLink. Mounted once in the app frame. */
export function NavMemory() {
  const path = usePathname(), sp = useSearchParams();
  useEffect(() => {
    try {
      const now = path + (sp?.toString() ? `?${sp}` : "");
      const m = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as { cur?: string; prev?: string };
      // Changing filters on the same page only updates where we are; a new page shifts it to "before".
      if (m.cur && m.cur.split("?")[0] !== path) sessionStorage.setItem(KEY, JSON.stringify({ prev: m.cur, cur: now }));
      else sessionStorage.setItem(KEY, JSON.stringify({ prev: m.prev, cur: now }));
    } catch { /* storage blocked: BackLink falls back to its link */ }
  }, [path, sp]);
  return null;
}

export default function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => {
    try { const m = JSON.parse(sessionStorage.getItem(KEY) ?? "{}"); if (m.prev && m.prev.split("?")[0] !== window.location.pathname) setPrev(m.prev); } catch { /* ignore */ }
  }, []);
  const name = prev ? NAMES.find(([re]) => re.test(prev.split("?")[0]))?.[1] : null;
  return (
    <Link href={prev ?? href} className="crumb" onClick={(e) => { if (prev && window.history.length > 1) { e.preventDefault(); router.back(); } }}>
      ‹ {name ? `Back to ${name}` : label}
    </Link>
  );
}
