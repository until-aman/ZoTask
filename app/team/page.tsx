import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { teamData } from "@/lib/team";
import TeamLeave from "@/components/TeamLeave";

export default async function TeamPage() {
  const u = await boot();
  if (u.access_role !== "admin") redirect("/");
  return <TeamLeave data={await teamData(u)} admin={u.access_role === "admin"} />;
}
