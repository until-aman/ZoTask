import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { escalationData } from "@/lib/escalations";
import { viewsFor } from "@/lib/views";
import Escalations from "@/components/esc/Escalations";

export default async function EscalationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await boot();
  if (!can.dashboard(u)) redirect("/tasks");
  return <Escalations data={await escalationData(u, await searchParams)} views={await viewsFor(u.id, "escalations")} />;
}
