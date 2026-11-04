import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { teamData } from "@/lib/team";
import TeamLeave from "@/components/TeamLeave";

export default async function TeamPage() {
  const u = await boot();
  if (!["admin", "cbm"].includes(u.access_role)) redirect("/");
  return <TeamLeave data={await teamData(u)} admin={u.access_role === "admin"} />;
}
