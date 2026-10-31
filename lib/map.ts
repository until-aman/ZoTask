// Map tab data: every Zolo property with a location, plus task health for the ones ZoTask runs.
import { all } from "./db";

export type Pin = {
  key: string; name: string; code: string; city: string; state: string; lat: number; lng: number;
  address: string; status: string; beds: number | null; propertyId: number | null; cluster: string; cbm: string;
  /** Last 7 days, ZoTask properties only. */
  health: { due: number; onTime: number | null; overdue: number } | null;
};
export type MapData = { pins: Pin[]; missing: { id: number; name: string; city: string }[]; uploaded: number; updatedAt: number | null };

export const zoloCode = (id: number) => `ZO${String(id).padStart(4, "0")}`;

export async function mapData(now = Date.now()): Promise<MapData> {
  const props = await all<{ id: number; name: string; lat: number | null; lng: number | null; city: string; cluster: string; cbm: string | null }>(
    `SELECT p.id, p.name, p.lat, p.lng, ci.name city, cl.name cluster, u.name cbm FROM properties p
     JOIN clusters cl ON cl.id = p.cluster_id JOIN cities ci ON ci.id = cl.city_id LEFT JOIN users u ON u.id = p.cbm_id`);
  const sites = await all<{ id: number; code: string | null; name: string; city: string | null; state: string | null; lat: number; lng: number; address: string | null; status: string; beds: number | null; property_id: number | null; updated_at: number | null }>(
    "SELECT * FROM map_sites ORDER BY name");
  const since = now - 7 * 864e5;
  const health = new Map((await all<{ property_id: number; due: number; ontime: number; overdue: number }>(
    `SELECT property_id, sum(window_end_at < ?) due, sum(window_end_at < ? AND first_submitted_at IS NOT NULL AND first_submitted_at <= window_end_at) ontime,
       sum(status = 'notsub') overdue FROM instances WHERE window_start_at >= ? GROUP BY property_id`, now, now, since)).map((h) => [h.property_id, h]));
  const byId = new Map(props.map((p) => [p.id, p]));
  const hp = (id: number | null) => {
    const h = id === null ? undefined : health.get(id);
    if (id === null || !byId.has(id)) return null;
    return { due: h?.due ?? 0, onTime: h?.due ? Math.round((h.ontime / h.due) * 100) : null, overdue: h?.overdue ?? 0 };
  };
  const pins: Pin[] = sites.map((s) => {
    const p = s.property_id === null ? undefined : byId.get(s.property_id);
    return {
      key: `s${s.id}`, name: s.name, code: s.code ?? (p ? zoloCode(p.id) : ""), city: s.city ?? p?.city ?? "", state: s.state ?? "", lat: s.lat, lng: s.lng,
      address: s.address ?? "", status: s.status || "Live", beds: s.beds, propertyId: p ? p.id : null, cluster: p?.cluster ?? "", cbm: p?.cbm ?? "", health: hp(p ? p.id : null),
    };
  });
  // ZoTask properties not in the sheet still show, from their own saved location.
  const linked = new Set(sites.map((s) => s.property_id));
  for (const p of props) {
    if (linked.has(p.id) || p.lat === null || p.lng === null) continue;
    pins.push({ key: `p${p.id}`, name: p.name, code: zoloCode(p.id), city: p.city, state: "", lat: p.lat, lng: p.lng, address: "", status: "Live", beds: null, propertyId: p.id, cluster: p.cluster, cbm: p.cbm ?? "", health: hp(p.id) });
  }
  const placed = new Set(pins.map((p) => p.propertyId));
  return {
    pins,
    missing: props.filter((p) => !placed.has(p.id)).map((p) => ({ id: p.id, name: p.name, city: p.city })),
    uploaded: sites.length,
    updatedAt: sites.reduce<number | null>((m, s) => (s.updated_at && (!m || s.updated_at > m) ? s.updated_at : m), null),
  };
}
