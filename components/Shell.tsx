// App frame: the menu on the left, the screen on the right.
import Link from "next/link";
import Nav from "@/components/Nav";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", reviewer: "Reviewer", auditor: "Auditor", cbm: "CBM", ground: "Ground team" };
type U = { name: string; access_role: string; op_role: string | null } | null | undefined;

export default function Shell({ user, links, children }: { user: U; links: [string, string][]; children: React.ReactNode }) {
  return (
    <div className={`shell${user ? "" : " bare"}`}>
      <aside className="side top">
        <div className="side-brand">
          <Link href="/" className="logo" aria-label="ZoTask home">Ω</Link>
          <Link href="/" className="brand">ZoTask</Link>
        </div>
        {user && <Nav links={links} />}
        {user && (
          <div className="me">
            <b>{user.name}</b>
            <span>{ROLE_LABEL[user.access_role]}{user.op_role && user.access_role === "ground" ? ` (${user.op_role})` : ""}</span>
            <Link href="/login">Switch user</Link>
          </div>
        )}
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
