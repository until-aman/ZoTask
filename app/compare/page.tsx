import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { compareData } from "@/lib/compare";
import ComparePage from "@/components/cc/ComparePage";

export default async function Compare({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await boot();
  if (!can.dashboard(u)) redirect("/tasks");
  return <ComparePage data={await compareData(u, await searchParams)} />;
}
