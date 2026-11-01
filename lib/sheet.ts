// Reads a property sheet (CSV text or Excel rows) into map rows plus each property's profile. Runs in the browser.
import { coordsFrom, inIndia } from "./geo";

export type Details = {
  gender?: string; mapsUrl?: string; photos?: string; description?: string; about?: string;
  amenities?: { name: string; yes: boolean }[];
  places?: { name: string; dist: string }[];
  transit?: { kind: string; name: string; dist: string }[];
  contacts?: { role: string; name: string; phone: string }[];
  staff?: number; compliance?: number; remarks?: string;
};
export type SiteInput = { code: string; name: string; city: string; state: string; lat: number; lng: number; address: string; status: string; beds: number | null; details: Details | null };
/** A row whose only location is a short Google Maps link, to be looked up before saving. */
export type Pending = { row: Omit<SiteInput, "lat" | "lng">; url: string; line: string };

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
const blank = (v: string) => /^(na|n\/a|nil|none|null|-+|—)$/i.test(v.trim());
const clean = (v: string) => (blank(v) ? "" : v.trim());
const NAME = /^(property|business|location|site|pg)?\s*name$|property.?name|business.?name/;
const SINGLE: [string, RegExp][] = [
  ["code", /zolo.?code|property.?code|store.?code|^code$|^id$/], ["city", /^city/], ["state", /^state|administrative/],
  ["lat", /^lat/], ["lng", /^(lng|lon)/], ["coords", /coord|lat.?long/], ["maps", /map.?link|maps|google/],
  ["address", /address/], ["status", /^status/], ["beds", /bed/], ["gender", /gender|^type$/],
  ["description", /description/], ["about", /^about/], ["photos", /photo|drive/], ["staff", /staff/], ["remarks", /remark/], ["compliance", /compliance/],
];
const AMENITY = /food|gym|lounge|terrace|game|kitchen|washing|laundry|refrigerator|fridge|parking|wi-?fi|^ac$|air.?con|lift|power|\btv\b|housekeeping|security|cctv/;
const TRANSIT = /^(train|railway|bus|metro|airport)/;
const ROLE = /^(cem|acem|gro|cbm|pm|manager|caretaker|warden|owner)\b.*name/;

function km(v: string) {
  const s = clean(v);
  if (!s) return "";
  if (/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return `${+Number(s).toFixed(2)} km`;
  return s.replace(/(\d)\s*(km|kms|kilometers?|kilometres?|m|mtrs?|meters?|metres?)\b/i, (_, d, u) => `${d} ${/^k/i.test(u) ? "km" : "m"}`);
}
const phone = (v: string) => {
  const s = clean(v);
  if (/^\d+(\.\d+)?(e\+?\d+)?$/i.test(s)) return String(Math.round(Number(s))); // Excel stores numbers like 9.494881211E9
  return s.replace(/[^\d+ ,/]/g, "").trim();
};
const yes = (v: string) => /^(y|yes|available|true|1)$/i.test(v.trim());
const label = (h: string) => h.split(/\n|\(/)[0].replace(/\s+availability$/i, "").replace(/\s+/g, " ").trim();
const keep = <T,>(a: T[]) => (a.length ? a : undefined);

/** Finds the header row (a row with a property name column), works out what every column holds and reads each property. */
export function readSheet(all: string[][]) {
  const rows = all.filter((r) => r.some((c) => c && c.trim()));
  const hi = Math.max(0, rows.slice(0, 6).findIndex((r) => r.some((c) => NAME.test(norm(c ?? "")))));
  const head = (rows[hi] ?? []).map((c) => c ?? ""), body = rows.slice(hi + 1), H = head.map(norm);
  const ix: Record<string, number> = {};
  const taken = new Set<number>();
  const nameAt = H.findIndex((h) => NAME.test(h));
  if (nameAt >= 0) { ix.name = nameAt; taken.add(nameAt); }
  for (const [k, re] of SINGLE) {
    const i = H.findIndex((h, j) => !taken.has(j) && re.test(h) && !(k !== "staff" && ROLE.test(h)) && !/distance/.test(h));
    if (i >= 0) { ix[k] = i; taken.add(i); }
  }
  const next = (i: number, re: RegExp) => (re.test(H[i + 1] ?? "") ? i + 1 : -1);
  const amen = H.map((h, i) => [h, i] as const).filter(([h, i]) => !taken.has(i) && AMENITY.test(h) && !/distance|name/.test(h));
  const places = H.map((h, i) => [h, i] as const).filter(([h]) => /demand|landmark|nearby (place|office)/.test(h) && !/distance/.test(h));
  const transit = H.map((h, i) => [h, i] as const).filter(([h]) => TRANSIT.test(h) && !/distance/.test(h));
  // A role can appear twice (e.g. CEM Name at the start and again by the mobile): use the one with a phone column next to it.
  const roles = new Map<string, { n: number; p: number }>();
  H.forEach((h, i) => {
    if (!ROLE.test(h)) return;
    const role = h.split(" ")[0].toUpperCase(), p = next(i, /mobile|phone|contact|number/);
    if (!roles.has(role) || (roles.get(role)!.p < 0 && p >= 0)) roles.set(role, { n: i, p });
  });

  const ok: SiteInput[] = [], pending: Pending[] = [], bad: string[] = [];
  body.forEach((r, n) => {
    const g = (k: string) => (ix[k] === undefined ? "" : clean(r[ix[k]] ?? ""));
    const at = (i: number) => (i < 0 ? "" : clean(r[i] ?? ""));
    const name = g("name"), line = `Row ${hi + n + 2}${name ? ` (${name})` : ""}`;
    if (!name) return void bad.push(`${line}: property name missing`);
    if (/\(delete this row\)/i.test(name)) return; // the template's example row
    const comp = parseFloat(g("compliance")), staff = parseFloat(g("staff"));
    const d: Details = {
      gender: g("gender") || undefined, mapsUrl: /^https?:/i.test(g("maps")) ? g("maps") : undefined,
      photos: /^https?:/i.test(g("photos")) ? g("photos") : undefined,
      description: g("description") || undefined, about: g("about") || undefined,
      amenities: keep(amen.filter(([, i]) => at(i)).map(([, i]) => ({ name: label(head[i]), yes: yes(at(i)) }))),
      places: keep(places.map(([, i]) => ({ name: at(i), dist: km(at(next(i, /distance/))) })).filter((p) => p.name)),
      transit: keep(transit.map(([h, i]) => ({ kind: h.split(" ")[0].replace(/^railway$/, "train"), name: at(i), dist: km(at(next(i, /distance/))) })).filter((p) => p.name)),
      contacts: keep([...roles].map(([role, c]) => ({ role, name: at(c.n), phone: phone(at(c.p)) })).filter((c) => c.name || c.phone)),
      staff: Number.isFinite(staff) ? staff : undefined,
      compliance: Number.isFinite(comp) ? Math.round(comp <= 1 ? comp * 100 : comp) : undefined,
      remarks: g("remarks") || undefined,
    };
    const beds = parseInt(g("beds"), 10);
    const row = { code: g("code"), name, city: g("city"), state: g("state"), address: g("address"), status: g("status"), beds: Number.isNaN(beds) ? null : beds,
      details: Object.values(d).some((v) => v !== undefined) ? d : null };
    let lat = parseFloat(g("lat")), lng = parseFloat(g("lng"));
    const pair = coordsFrom(g("coords")) ?? (Number.isNaN(lng) ? coordsFrom(g("lat")) : null) ?? coordsFrom(g("maps"));
    if (Number.isNaN(lat) || Number.isNaN(lng)) { if (pair) ({ lat, lng } = pair); }
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      if (!inIndia(lat, lng)) return void bad.push(`${line}: ${lat}, ${lng} is outside India. Are latitude and longitude swapped?`);
      return void ok.push({ ...row, lat, lng });
    }
    if (/^https?:\/\/[^/]*(goo\.gl|g\.page|google\.)/i.test(g("maps"))) return void pending.push({ row, url: g("maps"), line });
    bad.push(`${line}: no latitude and longitude, and no Google Maps link to read them from`);
  });
  return { ok, pending, bad, total: body.length, missingCols: (["name", "lat"] as const).filter((k) => ix[k] === undefined && !(k === "lat" && (ix.coords !== undefined || ix.maps !== undefined))) };
}
