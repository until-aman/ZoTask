"use server";
// Map tab server work: reading an uploaded Excel sheet, finding locations from Google Maps links, saving the property list. Admins only.
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { all, one, run, tx } from "@/lib/db";
import { zoloCode } from "@/lib/map";
import { coordsFrom, inIndia } from "@/lib/geo";
import { readXlsx } from "@/lib/xlsx";
import type { Details, SiteInput } from "@/lib/sheet";

type Result = { ok: true; msg: string; saved: number; linked: number } | { ok: false; error: string };

async function admin() {
  const u = await requireUser();
  return can.admin(u);
}

/** Rows of the first sheet of an uploaded .xlsx file. */
export async function readWorkbook(fd: FormData): Promise<{ ok: true; rows: string[][] } | { ok: false; error: string }> {
  if (!(await admin())) return { ok: false, error: "Only admins can upload locations." };
  const f = fd.get("file");
  if (!(f instanceof File)) return { ok: false, error: "No file received." };
  try { return { ok: true, rows: readXlsx(Buffer.from(await f.arrayBuffer())) }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

// Only Google's own short-link and Maps hosts are followed, so this can't be pointed at anything else.
const GOOGLE = /^(?:[\w-]+\.)*(?:goo\.gl|g\.page|google\.[a-z.]{2,6}|googleusercontent\.com)$/i;

/** Follows a Google Maps share link's redirects (without loading the page) and reads the pin from the address it lands on. */
async function locate(url: string): Promise<{ lat: number; lng: number } | null> {
  let at = url.trim();
  for (let hop = 0; hop < 6; hop++) {
    const hit = coordsFrom(at);
    if (hit) return hit;
    let u: URL;
    try { u = new URL(at); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!GOOGLE.test(u.hostname)) return null;
    // A cookie-consent stop keeps the real address in "continue".
    const cont = u.hostname.startsWith("consent.") && u.searchParams.get("continue");
    if (cont) { at = cont; continue; }
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (ZoTask property map)", "Accept-Language": "en-IN,en" } }).catch(() => null);
    const next = res?.headers.get("location");
    res?.body?.cancel().catch(() => {});
    if (!next) return null;
    at = new URL(next, u).toString();
  }
  return coordsFrom(at);
}

/** Looks up up to 40 links at a time; the browser sends them in batches and shows progress. */
export async function resolveMapLinks(urls: string[]): Promise<({ lat: number; lng: number } | null)[]> {
  if (!(await admin())) return urls.map(() => null);
  const out: ({ lat: number; lng: number } | null)[] = new Array(Math.min(urls.length, 40)).fill(null);
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < out.length) { const k = i++; out[k] = await locate(urls[k]).catch(() => null); }
  }));
  return out;
}

const STATUSES = ["Live", "Upcoming", "Closed"];

/** The uploaded sheet becomes the whole list: every earlier row and its details are deleted, in the same transaction. */
export async function saveMapSites(rows: SiteInput[]): Promise<Result> {
  if (!(await admin())) return { ok: false, error: "Only admins can upload locations." };
  const good = rows.filter((r) => r.name.trim() && Number.isFinite(r.lat) && Number.isFinite(r.lng) && inIndia(r.lat, r.lng));
  if (!good.length) return { ok: false, error: "No rows with a property name and a latitude and longitude in India." };
  try {
    let linked = 0;
    await tx(async () => {
      const props = await all<{ id: number; name: string }>("SELECT id, name FROM properties");
      const match = (r: SiteInput) => props.find((p) => r.code && zoloCode(p.id) === r.code.toUpperCase()) ?? props.find((p) => p.name.toLowerCase() === r.name.trim().toLowerCase());
      await run("DELETE FROM map_sites");
      const now = Date.now();
      for (const r of good) {
        const p = match(r);
        if (p) { linked++; await run("UPDATE properties SET lat=?, lng=? WHERE id=?", r.lat, r.lng, p.id); }
        // A property listed twice in the sheet keeps its last row.
        await run("DELETE FROM map_sites WHERE (code IS NOT NULL AND code <> '' AND upper(code)=upper(?)) OR lower(name)=lower(?)", r.code, r.name.trim());
        await run(`INSERT INTO map_sites (code, name, city, state, lat, lng, address, status, beds, property_id, updated_at, gender, details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          r.code.trim() || null, r.name.trim(), r.city.trim() || null, r.state.trim() || null, r.lat, r.lng, r.address.trim() || null,
          STATUSES.find((s) => s.toLowerCase() === r.status.trim().toLowerCase()) ?? "Live", r.beds, p?.id ?? null, now,
          r.details?.gender?.trim() || null, r.details ? JSON.stringify(r.details) : null);
      }
    });
    revalidatePath("/", "layout");
    return { ok: true, saved: good.length, linked, msg: `Saved ${good.length} propert${good.length === 1 ? "y" : "ies"}${linked ? `, ${linked} matched to ZoTask` : ""}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The full profile for one pin, loaded when it's opened (descriptions are too large to send with every pin). */
export async function siteDetails(id: number): Promise<Details | null> {
  if (!can.dashboard(await requireUser())) return null;
  const r = await one<{ details: string | null }>("SELECT details FROM map_sites WHERE id=?", id);
  try { return r?.details ? (JSON.parse(r.details) as Details) : null; } catch { return null; }
}
