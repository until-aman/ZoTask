import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "./globals.css";
import { currentUser, can } from "@/lib/auth";
import Shell from "@/components/Shell";
import type { NavItem } from "@/components/Nav";

export const metadata = { title: "TaskTrail", description: "Recurring operations tasks for Zolo properties" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  // The menu: single screens, and groups that fold open to show their screens.
  const links: NavItem[] = [];
  if (u) {
    if (can.tasks(u)) links.push({ href: "/tasks", label: "My Tasks" });
    if (can.queue(u)) links.push({ href: "/queue", label: "Review Queue" });
    if (can.dashboard(u)) links.push({ href: "/dashboard", label: "Analytics", icon: "/dashboard", children: [
      { href: "/dashboard", label: "Review Dashboard" }, { href: "/compare", label: "Compare" }] });
    if (can.escalations(u)) links.push({ href: "/escalations", label: "Escalations" });
    if (can.team(u)) links.push({ href: "/team", label: "Team availability", icon: "/team" });
    if (can.map(u)) links.push({ href: "/map", label: "Map" });
    if (can.admin(u)) links.push({ href: "/admin", label: "Admin", children: [
      ["tasks", "Tasks"], ["checklists", "Checklists"], ["schedules", "Schedules"], ["categories", "Categories"],
      ["counts", "HK counts"], ["clusters", "Clusters"], ["people", "Properties & people"], ["weekoffs", "Week offs and leave"],
    ].map(([k, l]) => ({ href: k === "tasks" ? "/admin" : `/admin?tab=${k}`, label: l })) });
  }
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>
        <Shell user={u} links={links}>{children}</Shell>
      </body>
    </html>
  );
}
