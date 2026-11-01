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
