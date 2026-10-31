import "./globals.css";
import { currentUser, can } from "@/lib/auth";
import Shell from "@/components/Shell";

export const metadata = { title: "ZoTask", description: "Recurring operations tasks for Zolo properties" };
export const dynamic = "force-dynamic";

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
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>
        <Shell user={u} links={links}>{children}</Shell>
      </body>
    </html>
  );
}
