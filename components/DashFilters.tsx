"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Geo = { city: string; cluster: string; property: string };
const PRESETS: [string, string][] = [["today", "Today"], ["yday", "Yesterday"], ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["custom", "Custom"]];

/** Date range (presets or custom) and City → Cluster → Property for the dashboard. */
export default function DashFilters({ geo, init, range }: { geo: Geo[]; init: { range: string; city?: string; cluster?: string; prop?: string }; range: { from: string; to: string } }) {
  const router = useRouter();
  const [preset, setPreset] = useState(init.range);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [city, setCity] = useState(init.city ?? "");
  const [cluster, setCluster] = useState(init.cluster ?? "");
  const [prop, setProp] = useState(init.prop ?? "");
  const go = (patch: Record<string, string> = {}) => {
    const v = { range: preset, city, cluster, prop, ...(preset === "custom" ? { from, to } : {}), ...patch };
    if (v.range !== "custom") { delete (v as Record<string, string>).from; delete (v as Record<string, string>).to; }
    router.push(`/dashboard?${new URLSearchParams(Object.entries(v).filter(([, x]) => x) as [string, string][])}`);
  };
  const cities = [...new Set(geo.map((g) => g.city))];
  const clusters = [...new Set(geo.filter((g) => !city || g.city === city).map((g) => g.cluster))];
  const props = geo.filter((g) => (!city || g.city === city) && (!cluster || g.cluster === cluster));
  return (
    <div className="row2">
      <div className="seg">
        {PRESETS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={preset === k} onClick={() => { setPreset(k); if (k !== "custom") go({ range: k }); }}>{l}</button>
        ))}
      </div>
      {preset === "custom" && (
        <span className="row2">
          <input type="date" id="dash-from" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <span className="muted">to</span>
          <input type="date" id="dash-to" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </span>
      )}
      <select id="dash-city" value={city} onChange={(e) => { setCity(e.target.value); setCluster(""); setProp(""); }} aria-label="City"><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</select>
      <select id="dash-cluster" value={cluster} onChange={(e) => { setCluster(e.target.value); setProp(""); }} aria-label="Cluster"><option value="">All clusters</option>{clusters.map((c) => <option key={c}>{c}</option>)}</select>
      <select id="dash-prop" value={prop} onChange={(e) => setProp(e.target.value)} aria-label="Property"><option value="">All properties</option>{props.map((p) => <option key={p.property}>{p.property}</option>)}</select>
      <button type="button" className="btn sm primary" disabled={preset === "custom" && (!from || !to || from > to)} onClick={() => go()}>Apply</button>
      {(init.city || init.cluster || init.prop) && <button type="button" className="link small" onClick={() => { setCity(""); setCluster(""); setProp(""); go({ city: "", cluster: "", prop: "" }); }}>Clear</button>}
    </div>
  );
}
