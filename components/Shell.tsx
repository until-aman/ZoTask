// App frame: the menu on the left, the screen on the right.
import Link from "next/link";
import { Suspense } from "react";
import Nav, { type NavItem } from "@/components/Nav";
import SideToggle from "@/components/SideToggle";
import NotificationBell from "@/components/NotificationBell";
import { NavMemory } from "@/components/BackLink";
import TableFit from "@/components/ui/TableFit";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", reviewer: "Reviewer", auditor: "Auditor", cbm: "CBM", ground: "Ground team" };
type U = { name: string; access_role: string; op_role: string | null } | null | undefined;

export default function Shell({ user, links, children }: { user: U; links: NavItem[]; children: React.ReactNode }) {
  return (
    <div className={`shell${user ? "" : " bare"}`}>
      <aside className="side top">
        <div className="side-brand">
          <Link href="/" className="logo" aria-label="TaskTrail home">T</Link>
          <Link href="/" className="brand">TaskTrail</Link>
          {user && <SideToggle />}
        </div>
        {user && <Suspense><Nav links={links} /></Suspense>}
        {user && (
          <div className="me">
            <b>{user.name}</b>
            <span>{ROLE_LABEL[user.access_role]}{user.op_role && user.access_role === "ground" ? ` (${user.op_role})` : ""}</span>
            <Link href="/login">Switch user</Link>
          </div>
        )}
      </aside>
      <div className="main"><TableFit />{user && <Suspense><NavMemory /></Suspense>}{user && <div className="topbar"><NotificationBell /></div>}{children}</div>
    </div>
  );
}
