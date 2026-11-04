"use client";
// Map tab: every Zolo property as a pin, grouped when zoomed out, with a list, filters and the location upload.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type * as Leaflet from "leaflet";
import type { MapData, Pin } from "@/lib/map";
import { readWorkbook, resolveMapLinks, saveMapSites } from "@/app/map-actions";
import { parseCsv, readSheet, type SiteInput } from "@/lib/sheet";
import { templateCsv, templateXlsx } from "@/lib/template";
import PropertyCard, { genderLabel } from "./PropertyCard";
import { ActiveChip, Field, FilterBar, Stats } from "@/components/ui/Filters";

type By = "status" | "health";
const STATUSES = ["Live", "Upcoming", "Closed"];

/** Pin colour class. Health: red under 70% on time or anything overdue, amber under 85%, green otherwise. */
function tone(p: Pin, by: By) {
  if (by === "status") return p.status === "Upcoming" ? "a" : p.status === "Closed" ? "x" : "b";
  if (!p.health || p.health.onTime === null) return "x";
  if (p.health.onTime < 70 || p.health.overdue > 2) return "r";
  return p.health.onTime < 85 || p.health.overdue > 0 ? "a" : "g";
}
const attention = (p: Pin) => !!p.health && ((p.health.onTime !== null && p.health.onTime < 85) || p.health.overdue > 0);

export default function PropertyMap({ data, admin }: { data: MapData; admin: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(""), [city, setCity] = useState(""), [gender, setGender] = useState(""), [status, setStatus] = useState(""), [only, setOnly] = useState("");
  const [by, setBy] = useState<By>("status");
  const [sel, setSel] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [sheet, setSheet] = useState<(ReturnType<typeof readSheet> & { file: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [look, setLook] = useState<{ done: number; total: number } | null>(null);
  const [noTiles, setNoTiles] = useState(false);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); }, [toast]);

  const genders = useMemo(() => [...new Set(data.pins.map((p) => genderLabel(p.gender)).filter(Boolean))].sort(), [data.pins]);
  const cities = useMemo(() => [...new Set(data.pins.map((p) => p.city).filter(Boolean))].sort(), [data.pins]);
  const pins = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.pins.filter((p) => (!city || p.city === city) && (!status || p.status === status) && (!gender || genderLabel(p.gender) === gender)
      && (!only || (only === "tasktrail" ? !!p.propertyId : only === "attention" ? attention(p) : !p.propertyId))
      && (!s || `${p.name} ${p.code} ${p.city} ${p.state} ${p.address} ${p.cluster} ${p.cbm} ${genderLabel(p.gender)}`.toLowerCase().includes(s)))
      .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  }, [data.pins, q, city, status, gender, only]);
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
    let rows: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      const fd = new FormData(); fd.append("file", f);
      setBusy(true);
      const r = await readWorkbook(fd).catch((e: Error) => ({ ok: false as const, error: e.message }));
      setBusy(false);
      if (!r.ok) { setToast(r.error); return; }
      rows = r.rows;
    } else if (/\.(csv|txt)$/i.test(f.name)) rows = parseCsv((await f.text()).replace(/^\uFEFF/, ""));
    else { setToast("Upload the sheet as Excel (.xlsx) or CSV."); return; }
    const s = readSheet(rows);
    setSheet({ ...s, file: f.name });
    if (s.pending.length) void lookup(s.pending);
  }
  // Short Google Maps links don't show coordinates, so the server follows each one to the full address, 20 at a time.
  async function lookup(todo: NonNullable<typeof sheet>["pending"]) {
    setLook({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i += 20) {
      const part = todo.slice(i, i + 20);
      const got = await resolveMapLinks(part.map((t) => t.url)).catch(() => part.map(() => null));
      const found: SiteInput[] = [], miss: string[] = [];
      part.forEach((t, k) => { const c = got[k]; if (c) found.push({ ...t.row, ...c }); else miss.push(`${t.line}: couldn't read a location from its Google Maps link. Add a Coordinates column for it, e.g. 12.93, 77.62`); });
      setSheet((s) => s && { ...s, ok: [...s.ok, ...found], bad: [...s.bad, ...miss], pending: s.pending.slice(part.length) });
      setLook({ done: Math.min(i + 20, todo.length), total: todo.length });
    }
    setLook(null);
  }
  async function save() {
    if (!sheet) return;
    setBusy(true);
    // One save: the new sheet replaces the whole list, or nothing changes if it fails.
    const r = await saveMapSites(sheet.ok).catch((e: Error) => ({ ok: false as const, error: e.message }));
    setBusy(false);
    setToast(r.ok ? r.msg : r.error);
    if (r.ok) { setSheet(null); router.refresh(); }
  }
  function template(kind: "xlsx" | "csv") {
    const blob = kind === "xlsx"
      ? new Blob([templateXlsx() as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      : new Blob([templateCsv()], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `zolo-properties-template.${kind}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const chips: ActiveChip[] = [
    city && { key: "city", label: city, clear: () => setCity("") },
    status && { key: "status", label: status, clear: () => setStatus("") },
    gender && { key: "gender", label: gender, clear: () => setGender("") },
    only && { key: "only", label: only === "tasktrail" ? "Run on TaskTrail" : only === "attention" ? "Needs attention" : "Not on TaskTrail yet", clear: () => setOnly("") },
  ].filter(Boolean) as ActiveChip[];
  const zt = data.pins.filter((p) => p.propertyId);
  const att = data.pins.filter(attention).length;

  return (
    <div className="page">
      <div className="phead"><div><h1>Property map</h1><p className="phead-sub">Every Zolo property, coloured by status or task health.</p></div>
        {admin && <button type="button" className="btn" onClick={() => setSheet(sheet ? null : { ok: [], pending: [], bad: [], total: 0, missingCols: [], file: "" })}>Upload locations</button>}
      </div>
      <FilterBar search={q} setSearch={setQ} searchLabel="Search property, code, city, address or CBM" chips={chips} onClearAll={() => { setCity(""); setStatus(""); setGender(""); setOnly(""); }}
        right={<span className="seg" role="group" aria-label="Colour pins by">
          <button type="button" aria-pressed={by === "status"} onClick={() => setBy("status")}>By status</button>
          <button type="button" aria-pressed={by === "health"} onClick={() => setBy("health")}>By task health</button>
        </span>}
        panel={<>
          <Field label="City"><select value={city} onChange={(e) => setCity(e.target.value)}><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          {genders.length > 0 && <Field label="For"><select value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Anyone</option>{genders.map((g) => <option key={g}>{g}</option>)}</select></Field>}
          <Field label="Show"><select value={only} onChange={(e) => setOnly(e.target.value)}><option value="">All properties</option><option value="tasktrail">Run on TaskTrail</option><option value="attention">Needs attention</option><option value="other">Not on TaskTrail yet</option></select></Field>
        </>} />

      {sheet && <section className="card grid mupload" aria-label="Upload locations">
        <div className="row2"><b>Upload property locations</b><span className="spacer" /><button type="button" className="link small" onClick={() => setSheet(null)}>Close</button></div>
        <p className="small muted" style={{ margin: 0 }}>Upload the complete property sheet as Excel (.xlsx) or CSV, one row per property. Download the template for every column, with an example row (it is skipped if left in). Only <b>Property Name</b> and a location are needed: Latitude and Longitude, a &ldquo;Coordinates&rdquo; column like &ldquo;12.93, 77.62&rdquo;, or a Google Maps link (short share links are looked up for you). Everything else (gender, address, write-ups, amenities, demand centres, transit, staff contacts, compliance) goes on the property&apos;s card. Each upload replaces the whole list.</p>
        <div className="row2">
          <button type="button" className="btn sm" onClick={() => template("xlsx")}>Download Excel template</button>
          <button type="button" className="btn sm" onClick={() => template("csv")}>CSV template</button>
          <label className="btn sm primary" style={{ cursor: "pointer" }}>{busy && !sheet.file ? "Reading…" : sheet.file ? "Choose another file" : "Choose Excel or CSV file"}<input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
          {sheet.file && <span className="small muted">{sheet.file}</span>}
        </div>
        {sheet.file && <>
          {sheet.missingCols.length > 0 && <p className="small t-r" style={{ margin: 0 }}>Couldn&apos;t find a {sheet.missingCols.map((c) => (c === "name" ? "Property Name" : "Latitude/Longitude")).join(" or ")} column. Check the first row has the column names.</p>}
          <div className="stats sm">
            <div className="stat"><span className="stat-h"><b>{sheet.total}</b><span className="stat-l">Rows read</span></span></div>
            <div className="stat"><span className="stat-h"><b className="t-g">{sheet.ok.length}</b><span className="stat-l">Ready to place</span></span></div>
            {(look || sheet.pending.length > 0) && <div className="stat"><span className="stat-h"><b className="t-a">{sheet.pending.length}</b><span className="stat-l">Looking up Maps links</span></span></div>}
            <div className="stat"><span className="stat-h"><b className={sheet.bad.length ? "t-r" : ""}>{sheet.bad.length}</b><span className="stat-l">Will be skipped</span></span></div>
          </div>
          {look && <div className="mlook" role="status"><div className="small">Finding locations from Google Maps links: {look.done} of {look.total}</div><div className="mbar"><i style={{ width: `${(look.done / look.total) * 100}%` }} /></div></div>}
          {sheet.bad.length > 0 && <ul className="small mbad">{sheet.bad.slice(0, 8).map((b) => <li key={b}>{b}</li>)}{sheet.bad.length > 8 && <li>and {sheet.bad.length - 8} more</li>}</ul>}
          <div className="row2">
            <span className="small muted">Saving replaces the whole list: properties and details from earlier uploads are deleted.</span>
            <span className="spacer" />
            <button type="button" className="btn primary sm" disabled={!sheet.ok.length || busy || !!look} onClick={save}>{busy ? "Saving…" : `Save ${sheet.ok.length} location${sheet.ok.length === 1 ? "" : "s"}`}</button>
          </div>
        </>}
      </section>}

      <Stats compact items={[
        { key: "all", label: "Properties on map", value: data.pins.length, sub: `${cities.length} cit${cities.length === 1 ? "y" : "ies"}`, active: !chips.length, onClick: () => { setCity(""); setStatus(""); setGender(""); setOnly(""); } },
        { key: "tt", label: "Run on TaskTrail", value: zt.length, sub: data.uploaded ? `${data.pins.length - zt.length} not yet` : "Upload the full list to see the rest", active: only === "tasktrail", onClick: () => setOnly(only === "tasktrail" ? "" : "tasktrail") },
        { key: "att", label: "Need attention", value: att, tone: att ? "a" : undefined, sub: "Under 85% on time or overdue, last 7 days", active: only === "attention", onClick: () => { setOnly(only === "attention" ? "" : "attention"); setBy("health"); } },
        { key: "miss", label: "Missing location", value: data.missing.length, tone: data.missing.length ? "r" : undefined, sub: data.missing.length ? data.missing.slice(0, 3).map((m) => m.name).join(", ") + (data.missing.length > 3 ? "…" : "") : "Every TaskTrail property is placed" },
      ]} />

      <div className="mapwrap">
        <div className="mapbox">
          <div ref={box} className="pmap" role="application" aria-label="Map of Zolo properties" />
          <div className="mlegend small">{by === "status"
            ? <><i className="t-b" />Live<i className="t-a" />Upcoming<i className="t-x" />Closed</>
            : <><i className="t-g" />85%+ on time<i className="t-a" />Under 85% or overdue<i className="t-r" />Under 70%<i className="t-x" />Not on TaskTrail</>}
            {noTiles && <span className="muted">· Street map can&apos;t load here, so an outline of India is shown</span>}</div>
          {!pins.length && <div className="mnote small">No properties match these filters.</div>}
        </div>
        <aside className="mlist card" aria-label="Properties">
          <div className="mlist-h small muted">{pins.length} of {data.pins.length} properties</div>
          <ul>
            {pins.map((p, i) => <li key={p.key}>
              {(i === 0 || pins[i - 1].city !== p.city) && <div className="mcity">{p.city || "No city"}</div>}
              <button type="button" className={`mrow${p.key === sel ? " on" : ""}`} onClick={() => focus(p)}>
                <span className={`dot t-${tone(p, by)}`} />
                <span className="mrow-t"><b>{p.name}</b><span className="small muted">{[p.code, genderLabel(p.gender), p.status !== "Live" && p.status].filter(Boolean).join(" · ")}</span></span>
                {p.health && p.health.onTime !== null && <span className="small mono">{p.health.onTime}%</span>}
              </button>
            </li>)}
          </ul>
        </aside>
      </div>
      {picked && <PropertyCard pin={picked} pins={data.pins} onClose={() => setSel(null)} onPick={focus} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
