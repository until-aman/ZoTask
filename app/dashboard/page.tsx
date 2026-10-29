import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { buildCommand } from "@/lib/command";
import CommandCenter from "@/components/cc/CommandCenter";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await boot();
  if (!can.dashboard(u)) redirect("/tasks");
  return <CommandCenter data={await buildCommand(u, await searchParams)} />;
}
