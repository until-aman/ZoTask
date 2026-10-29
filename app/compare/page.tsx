import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { compareData } from "@/lib/compare";
import { viewsFor } from "@/lib/views";
import ComparePage from "@/components/cc/ComparePage";

export default async function Compare({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await boot();
  if (!can.dashboard(u)) redirect("/tasks");
  const sp = await searchParams;
  return <ComparePage data={await compareData(u, sp)} views={await viewsFor(u.id, "compare")} bare={!Object.keys(sp).length} />;
}
