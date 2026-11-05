import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { teamData } from "@/lib/team";
import TeamLeave from "@/components/TeamLeave";

// Team availability: a reviewer sees, read-only, who works at their properties and when they're off.
// Admins manage the same list in Admin › Week offs and leave.
export default async function TeamPage() {
  const u = await boot();
  if (u.access_role === "admin") redirect("/admin?tab=weekoffs");
  if (!can.team(u)) redirect("/");
  return <TeamLeave data={await teamData(u)} admin={false} />;
}
