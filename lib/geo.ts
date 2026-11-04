// Small location helpers shared by the browser and the server.

export const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;

/** Reads a latitude and longitude out of text: a Google Maps URL (the pin, then the view centre) or a "12.93, 77.62" pair. */
export function coordsFrom(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text.replace(/\+/g, " ").replace(/%(?![0-9a-f]{2})/gi, "%25"));
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // the place's own pin
    /[?&](?:q|query|ll|center|destination|daddr)=\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/,
    /\/(?:place|search|dir)\/[^/]*?(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/, // where the map was looking
    /^\s*\(?\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{2,3}\.\d+)\s*\)?\s*$/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (!m) continue;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (inIndia(lat, lng)) return { lat, lng };
  }
  return null;
}

/** Straight-line distance in km. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`);
/** How a submission's location check reads to a reviewer, with a pill tone. */
export function locationLabel(s: { location_ok: number | null; distance_m: number | null; location_src: string | null; accuracy_m?: number | null }): [string, "g" | "a" | "r"] {
  if (s.location_src === "simulated") return ["Simulated (demo), not checked", "a"];
  if (s.location_src === "approx") return [`Not verified: device gave only a rough area (±${dist(s.accuracy_m ?? 0)})`, "a"];
  if (s.location_ok === null) return ["Not checked", "a"];
  if (s.location_ok) return ["At property", "g"];
  return [`${dist(s.distance_m ?? 0)} away`, "r"];
}
