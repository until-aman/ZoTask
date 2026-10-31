"use client";
// Map tab: every Zolo property as a pin, grouped when zoomed out, with a list, filters and the location upload.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as Leaflet from "leaflet";
import type { MapData, Pin } from "@/lib/map";
import { saveMapSites, SiteInput } from "@/app/map-actions";
import { ActiveChip, Field, FilterBar, Stats } from "@/components/ui/Filters";

type By = "status" | "health";
const STATUSES = ["Live", "Upcoming", "Closed"];
const COLS = ["Zolo Code", "Property Name", "City", "State", "Latitude", "Longitude", "Address", "Status", "Beds"];

/** Pin colour class. Health: red under 70% on time or anything overdue, amber under 85%, green otherwise. */
function tone(p: Pin, by: By) {
  if (by === "status") return p.status === "Upcoming" ? "a" : p.status === "Closed" ? "x" : "b";
  if (!p.health || p.health.onTime === null) return "x";
  if (p.health.onTime < 70 || p.health.overdue > 2) return "r";
  return p.health.onTime < 85 || p.health.overdue > 0 ? "a" : "g";
}
const attention = (p: Pin) => !!p.health && ((p.health.onTime !== null && p.health.onTime < 85) || p.health.overdue > 0);

// Sheet reading: a header row, then one property per row. Column names are matched loosely.
function parseCsv(text: string) {
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
  return rows.filter((r) => r.some((c) => c.trim()));
}
const FIELDS: [keyof SiteInput | "coords", RegExp][] = [
  ["code", /zolo.?code|property.?code|^code$|^id$/], ["name", /name|property/], ["city", /city/], ["state", /state/],
  ["coords", /coord|lat.?long|location|google/], ["lat", /^lat/], ["lng", /^(lng|lon)/], ["address", /address/], ["status", /status/], ["beds", /bed/],
];
function readSheet(text: string) {
  const [head = [], ...body] = parseCsv(text.replace(/^﻿/, ""));
  const ix: Partial<Record<string, number>> = {};
  head.forEach((h, i) => { const k = FIELDS.find(([f, re]) => ix[f] === undefined && re.test(h.trim().toLowerCase()))?.[0]; if (k) ix[k] = i; });
  const ok: SiteInput[] = [], bad: string[] = [];
  body.forEach((r, n) => {
    const g = (k: string) => (ix[k] === undefined ? "" : (r[ix[k]!] ?? "").trim());
    let lat = parseFloat(g("lat")), lng = parseFloat(g("lng"));
    const pair = (g("coords") || (Number.isNaN(lng) ? g("lat") : "")).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (pair) { lat = parseFloat(pair[1]); lng = parseFloat(pair[2]); }
    const name = g("name"), line = `Row ${n + 2}${name ? ` (${name})` : ""}`;
    if (!name) return void bad.push(`${line}: property name missing`);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return void bad.push(`${line}: latitude or longitude missing`);
    if (lat < 6 || lat > 37.5 || lng < 68 || lng > 97.5) return void bad.push(`${line}: ${lat}, ${lng} is outside India. Are latitude and longitude swapped?`);
    const beds = parseInt(g("beds"), 10);
    ok.push({ code: g("code"), name, city: g("city"), state: g("state"), lat, lng, address: g("address"), status: g("status"), beds: Number.isNaN(beds) ? null : beds });
  });
  return { ok, bad, total: body.length, missingCols: (["name", "lat"] as const).filter((k) => ix[k] === undefined && !(k === "lat" && ix.coords !== undefined)) };
}

export default function PropertyMap({ data, admin }: { data: MapData; admin: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(""), [city, setCity] = useState(""), [status, setStatus] = useState(""), [only, setOnly] = useState("");
  const [by, setBy] = useState<By>("status");
  const [sel, setSel] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [sheet, setSheet] = useState<(ReturnType<typeof readSheet> & { file: string }) | null>(null);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noTiles, setNoTiles] = useState(false);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); }, [toast]);

  const cities = useMemo(() => [...new Set(data.pins.map((p) => p.city).filter(Boolean))].sort(), [data.pins]);
  const pins = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.pins.filter((p) => (!city || p.city === city) && (!status || p.status === status)
      && (!only || (only === "zotask" ? !!p.propertyId : only === "attention" ? attention(p) : !p.propertyId))
      && (!s || `${p.name} ${p.code} ${p.city} ${p.state} ${p.address} ${p.cluster} ${p.cbm}`.toLowerCase().includes(s)))
      .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  }, [data.pins, q, city, status, only]);
  const picked = pins.find((p) => p.key === sel) ?? null;

  // The map itself. Leaflet only runs in the browser, so it loads after the page.
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<{ L: typeof Leaflet; m: Leaflet.Map; group: Leaflet.MarkerClusterGroup; marks: Map<string, Leaflet.Marker> } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      const L = (await import("leaflet")).default;
      (window as unknown as { L: typeof Leaflet }).L = L;
      await import("leaflet.markercluster");
      if (dead || !box.current || map.current) return;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true, minZoom: 4, maxBounds: [[2, 60], [40, 102]] }).setView([22.5, 80], 5);
      // Street map tiles. Where they can't load (offline, or a locked-down page), an outline of India stands in.
      let loaded = 0, failed = 0, outline = false;
      const fallback = async () => {
        if (outline) return;
        outline = true; setNoTiles(true);
        const india = (await import("./india.json")).default as GeoJSON.MultiPolygon;
        L.geoJSON(india, { interactive: false, style: { color: "#94a3b8", weight: 1.2, fillColor: "#ffffff", fillOpacity: 1 } })
          .addTo(m).bringToBack();
        m.attributionControl.addAttribution('India boundary: <a href="https://github.com/datameet/maps" target="_blank" rel="noreferrer">DataMeet</a> (CC BY 4.0)');
      };
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" })
        .on("tileload", () => { loaded++; })
        .on("tileerror", () => { failed++; if (failed > 3 && !loaded) void fallback(); })
        .addTo(m);
      const group = L.markerClusterGroup({
        showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true,
        iconCreateFunction: (c) => { const n = c.getChildCount(); return L.divIcon({ html: `<span>${n}</span>`, className: `mclus${n >= 50 ? " l" : n >= 10 ? " m" : ""}`, iconSize: [36, 36] }); },
      }).addTo(m);
      map.current = { L, m, group, marks: new Map() };
      setReady(true);
    })();
    return () => { dead = true; map.current?.m.remove(); map.current = null; };
  }, []);

  // Redraw pins when the filters or colouring change, and fit the view to them.
  useEffect(() => {
    const mm = map.current;
    if (!ready || !mm) return;
    const { L, m, group, marks } = mm;
    group.clearLayers(); marks.clear();
    for (const p of pins) {
      const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: `mpin t-${tone(p, by)}`, html: "<span></span>", iconSize: [16, 16] }), title: p.name, keyboard: true });
      mk.bindTooltip(`${p.name.replace(/[<>&]/g, "")}`, { direction: "top", offset: [0, -8] });
      mk.on("click", () => setSel(p.key));
      group.addLayer(mk); marks.set(p.key, mk);
    }
    if (pins.length) m.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30], maxZoom: 13 });
  }, [pins, by, ready]);

  function focus(p: Pin) {
    setSel(p.key);
    const mm = map.current, mk = mm?.marks.get(p.key);
    if (mm && mk) mm.group.zoomToShowLayer(mk, () => { mm.m.setView(mk.getLatLng(), Math.max(mm.m.getZoom(), 14)); mk.openTooltip(); });
  }
  useEffect(() => { if (sel && !pins.some((p) => p.key === sel)) setSel(null); }, [pins, sel]);

  async function upload(f: File | undefined) {
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) { setToast("Please save the sheet as CSV (File › Save as › CSV) and upload that."); return; }
    setSheet({ ...readSheet(await f.text()), file: f.name });
  }
  async function save() {
    if (!sheet) return;
    setBusy(true);
    const r = await saveMapSites(sheet.ok, replace);
    setBusy(false);
    setToast(r.ok ? r.msg : r.error);
    if (r.ok) { setSheet(null); router.refresh(); }
  }
  function template() {
    const csv = [COLS.join(","), "ZO0001,Zolo Euphoria for Men,Bangalore,Karnataka,12.9352,77.6245,\"80 Feet Road, Koramangala\",Live,120"].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "zolo-property-locations.csv"; a.click();
  }

  const chips: ActiveChip[] = [
    city && { key: "city", label: city, clear: () => setCity("") },
    status && { key: "status", label: status, clear: () => setStatus("") },
    only && { key: "only", label: only === "zotask" ? "Run on ZoTask" : only === "attention" ? "Needs attention" : "Not on ZoTask yet", clear: () => setOnly("") },
  ].filter(Boolean) as ActiveChip[];
  const zt = data.pins.filter((p) => p.propertyId);
  const att = data.pins.filter(attention).length;

  return (
    <div className="page">
      <div className="row2"><h1>Property map</h1><span className="spacer" />
        {admin && <button type="button" className="btn" onClick={() => setSheet(sheet ? null : { ok: [], bad: [], total: 0, missingCols: [], file: "" })}>Upload locations</button>}
      </div>
      <FilterBar search={q} setSearch={setQ} searchLabel="Search property, code, city, address or CBM" chips={chips} onClearAll={() => { setCity(""); setStatus(""); setOnly(""); }}
        right={<span className="seg" role="group" aria-label="Colour pins by">
          <button type="button" aria-pressed={by === "status"} onClick={() => setBy("status")}>By status</button>
          <button type="button" aria-pressed={by === "health"} onClick={() => setBy("health")}>By task health</button>
        </span>}
        panel={<>
          <Field label="City"><select value={city} onChange={(e) => setCity(e.target.value)}><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Show"><select value={only} onChange={(e) => setOnly(e.target.value)}><option value="">All properties</option><option value="zotask">Run on ZoTask</option><option value="attention">Needs attention</option><option value="other">Not on ZoTask yet</option></select></Field>
        </>} />

      {sheet && <section className="card grid mupload" aria-label="Upload locations">
        <div className="row2"><b>Upload property locations</b><span className="spacer" /><button type="button" className="link small" onClick={() => setSheet(null)}>Close</button></div>
        <p className="small muted" style={{ margin: 0 }}>One row per property, saved as CSV. Columns: <b>{COLS.join(", ")}</b>. Property Name, Latitude and Longitude are needed; the rest is optional. Status is Live, Upcoming or Closed. A single &ldquo;Coordinates&rdquo; column with &ldquo;12.93, 77.62&rdquo; (as Google Maps copies it) works too. Rows are matched to ZoTask properties by Zolo Code, then by name.</p>
        <div className="row2">
          <button type="button" className="btn sm" onClick={template}>Download template</button>
          <label className="btn sm primary" style={{ cursor: "pointer" }}>{sheet.file ? "Choose another file" : "Choose CSV file"}<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
          {sheet.file && <span className="small muted">{sheet.file}</span>}
        </div>
        {sheet.file && <>
          {sheet.missingCols.length > 0 && <p className="small t-r" style={{ margin: 0 }}>Couldn&apos;t find a {sheet.missingCols.map((c) => (c === "name" ? "Property Name" : "Latitude/Longitude")).join(" or ")} column. Check the first row has the column names.</p>}
          <div className="stats sm">
            <div className="stat"><span className="stat-h"><b>{sheet.total}</b><span className="stat-l">Rows read</span></span></div>
            <div className="stat"><span className="stat-h"><b className="t-g">{sheet.ok.length}</b><span className="stat-l">Ready to place</span></span></div>
            <div className="stat"><span className="stat-h"><b className={sheet.bad.length ? "t-r" : ""}>{sheet.bad.length}</b><span className="stat-l">Will be skipped</span></span></div>
          </div>
          {sheet.bad.length > 0 && <ul className="small mbad">{sheet.bad.slice(0, 8).map((b) => <li key={b}>{b}</li>)}{sheet.bad.length > 8 && <li>and {sheet.bad.length - 8} more</li>}</ul>}
          <div className="row2">
            <label className="opt"><input type="radio" checked={replace} onChange={() => setReplace(true)} />Replace the whole list with this sheet</label>
            <label className="opt"><input type="radio" checked={!replace} onChange={() => setReplace(false)} />Add these and update matching ones</label>
            <span className="spacer" />
            <button type="button" className="btn primary sm" disabled={!sheet.ok.length || busy} onClick={save}>{busy ? "Saving…" : `Save ${sheet.ok.length} location${sheet.ok.length === 1 ? "" : "s"}`}</button>
          </div>
        </>}
      </section>}

      <Stats compact items={[
        { key: "all", label: "Properties on map", value: data.pins.length, sub: `${cities.length} cit${cities.length === 1 ? "y" : "ies"}`, active: !chips.length, onClick: () => { setCity(""); setStatus(""); setOnly(""); } },
        { key: "zt", label: "Run on ZoTask", value: zt.length, sub: data.uploaded ? `${data.pins.length - zt.length} not yet` : "Upload the full list to see the rest", active: only === "zotask", onClick: () => setOnly(only === "zotask" ? "" : "zotask") },
        { key: "att", label: "Need attention", value: att, tone: att ? "a" : undefined, sub: "Under 85% on time or overdue, last 7 days", active: only === "attention", onClick: () => { setOnly(only === "attention" ? "" : "attention"); setBy("health"); } },
        { key: "miss", label: "Missing location", value: data.missing.length, tone: data.missing.length ? "r" : undefined, sub: data.missing.length ? data.missing.slice(0, 3).map((m) => m.name).join(", ") + (data.missing.length > 3 ? "…" : "") : "Every ZoTask property is placed" },
      ]} />

      <div className="mapwrap">
        <div className="mapbox">
          <div ref={box} className="pmap" role="application" aria-label="Map of Zolo properties" />
          <div className="mlegend small">{by === "status"
            ? <><i className="t-b" />Live<i className="t-a" />Upcoming<i className="t-x" />Closed</>
            : <><i className="t-g" />85%+ on time<i className="t-a" />Under 85% or overdue<i className="t-r" />Under 70%<i className="t-x" />Not on ZoTask</>}
            {noTiles && <span className="muted">· Street map can&apos;t load here, so an outline of India is shown</span>}</div>
          {!pins.length && <div className="mnote small">No properties match these filters.</div>}
        </div>
        <aside className="mlist card" aria-label="Properties">
          {picked && <div className="mpick">
            <div className="row2"><b>{picked.name}</b><span className="spacer" /><button type="button" className="link small" onClick={() => setSel(null)}>Close</button></div>
            <div className="small muted">{[picked.code, picked.city, picked.state].filter(Boolean).join(" · ")}</div>
            {picked.address && <div className="small">{picked.address}</div>}
            <div className="mfacts small">
              <span><span className={`dot t-${tone(picked, "status")}`} />{picked.status}</span>
              {picked.beds !== null && <span>{picked.beds} beds</span>}
              {picked.cluster && <span>{picked.cluster} cluster</span>}
              {picked.cbm && <span>CBM {picked.cbm}</span>}
            </div>
            {picked.health ? <div className="mfacts small">
              <span><b>{picked.health.onTime === null ? "–" : `${picked.health.onTime}%`}</b> done on time (7 days)</span>
              <span className={picked.health.overdue ? "t-r" : ""}><b>{picked.health.overdue}</b> overdue now</span>
            </div> : <div className="small muted">Not on ZoTask yet.</div>}
            <div className="row2">
              {picked.propertyId && <Link className="btn sm" href={`/dashboard?q=${encodeURIComponent(picked.name)}`}>Open in dashboard</Link>}
              <a className="btn sm" href={`https://www.google.com/maps/search/?api=1&query=${picked.lat},${picked.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
            </div>
          </div>}
          <div className="mlist-h small muted">{pins.length} of {data.pins.length} properties</div>
          <ul>
            {pins.map((p, i) => <li key={p.key}>
              {(i === 0 || pins[i - 1].city !== p.city) && <div className="mcity">{p.city || "No city"}</div>}
              <button type="button" className={`mrow${p.key === sel ? " on" : ""}`} onClick={() => focus(p)}>
                <span className={`dot t-${tone(p, by)}`} />
                <span className="mrow-t"><b>{p.name}</b><span className="small muted">{[p.code, p.status !== "Live" && p.status].filter(Boolean).join(" · ")}</span></span>
                {p.health && p.health.onTime !== null && <span className="small mono">{p.health.onTime}%</span>}
              </button>
            </li>)}
          </ul>
        </aside>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
