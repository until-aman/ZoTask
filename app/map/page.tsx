import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { mapData } from "@/lib/map";
import PropertyMap from "@/components/map/PropertyMap";

// Looking up Google Maps links during an upload can take a while.
export const maxDuration = 60;

export default async function MapPage() {
  const u = await boot();
  if (!can.dashboard(u)) redirect("/tasks");
  return <PropertyMap data={await mapData()} admin={can.admin(u)} />;
}
