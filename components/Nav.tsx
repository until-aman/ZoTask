"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav({ links }: { links: [string, string][] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="ZoTask">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? "on" : ""}>{label}</Link>
      ))}
    </nav>
  );
}
