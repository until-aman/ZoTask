"use server";
// Saves the uploaded property-location sheet. Admins only.
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { all, run, tx } from "@/lib/db";
import { zoloCode } from "@/lib/map";

export type SiteInput = { code: string; name: string; city: string; state: string; lat: number; lng: number; address: string; status: string; beds: number | null };
type Result = { ok: true; msg: string } | { ok: false; error: string };

const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;

/** replace: the sheet becomes the full list. Otherwise rows are added, or update the row with the same code or name. */
export async function saveMapSites(rows: SiteInput[], replace: boolean): Promise<Result> {
  const u = await requireUser();
  if (!can.admin(u)) return { ok: false, error: "Only admins can upload locations." };
  const good = rows.filter((r) => r.name.trim() && Number.isFinite(r.lat) && Number.isFinite(r.lng) && inIndia(r.lat, r.lng));
  if (!good.length) return { ok: false, error: "No rows with a property name and a latitude and longitude in India." };
  try {
    let linked = 0;
    await tx(async () => {
      const props = await all<{ id: number; name: string }>("SELECT id, name FROM properties");
      const match = (r: SiteInput) => props.find((p) => r.code && zoloCode(p.id) === r.code.toUpperCase()) ?? props.find((p) => p.name.toLowerCase() === r.name.trim().toLowerCase());
      if (replace) await run("DELETE FROM map_sites");
      const now = Date.now();
      for (const r of good) {
        const p = match(r);
        if (p) { linked++; await run("UPDATE properties SET lat=?, lng=? WHERE id=?", r.lat, r.lng, p.id); }
        if (!replace) await run("DELETE FROM map_sites WHERE (code IS NOT NULL AND code <> '' AND upper(code)=upper(?)) OR lower(name)=lower(?)", r.code, r.name.trim());
        await run(`INSERT INTO map_sites (code, name, city, state, lat, lng, address, status, beds, property_id, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          r.code.trim() || null, r.name.trim(), r.city.trim() || null, r.state.trim() || null, r.lat, r.lng, r.address.trim() || null,
          ["Live", "Upcoming", "Closed"].find((s) => s.toLowerCase() === r.status.trim().toLowerCase()) ?? "Live", r.beds, p?.id ?? null, now);
      }
    });
    revalidatePath("/", "layout");
    const skipped = rows.length - good.length;
    return { ok: true, msg: `Saved ${good.length} propert${good.length === 1 ? "y" : "ies"}${linked ? `, ${linked} matched to ZoTask` : ""}${skipped ? `. ${skipped} skipped` : ""}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
