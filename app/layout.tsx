import "./globals.css";
import Link from "next/link";
import { currentUser, can } from "@/lib/auth";
import Nav from "@/components/Nav";

export const metadata = { title: "ZoTask", description: "Recurring operations tasks for Zolo properties" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", reviewer: "Reviewer", auditor: "Auditor", cbm: "CBM", ground: "Ground team" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  const links: [string, string][] = [];
  if (u) {
    if (can.tasks(u)) links.push(["/tasks", "My Tasks"]);
    if (can.queue(u)) links.push(["/queue", "Review Queue"]);
    if (can.dashboard(u)) links.push(["/dashboard", "Review Dashboard"]);
    if (can.dashboard(u)) links.push(["/compare", "Compare"]);
    if (can.dashboard(u)) links.push(["/escalations", "Escalations"]);
    if (can.admin(u)) links.push(["/admin", "Admin"]);
  }
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap" />
      </head>
      <body>
        <header className="top">
          <div className="top-in">
            <Link href="/" className="logo" aria-label="ZoTask home">Ω</Link>
            <Link href="/" className="brand">ZoTask</Link>
            <Nav links={links} />
            {u && (
              <span className="me">
                <b>{u.name}</b> · {ROLE_LABEL[u.access_role]}{u.op_role && u.access_role === "ground" ? ` (${u.op_role})` : ""} · <Link href="/login">Switch user</Link>
              </span>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
