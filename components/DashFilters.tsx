"use client";
// Dashboard filters behind one Filters button: date range, City → Cluster → Property, task type, reviewer, portfolio.
// Filters live in the URL, so saved filters store the URL parameters.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActiveChip, Field, FilterBar, SavedView, sameFilters } from "@/components/ui/Filters";

type Geo = { city: string; cluster: string; property: string };
const PRESETS: [string, string][] = [["today", "Today"], ["yday", "Yesterday"], ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["custom", "Custom"]];
type P = Record<string, string>;

export default function DashFilters({ geo, init, range, cats = [], mine, reviewers = [], views, bare, notify }: {
  geo: Geo[]; init: { range: string; city?: string; cluster?: string; prop?: string; cat?: string; rv?: string }; range: { from: string; to: string }; cats?: string[]; mine?: boolean;
  reviewers?: { id: number; name: string }[]; views: SavedView[]; bare: boolean; notify: (m: string) => void;
}) {
  const router = useRouter();
  const [preset, setPreset] = useState(init.range);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [city, setCity] = useState(init.city ?? "");
  const [cluster, setCluster] = useState(init.cluster ?? "");
  const [prop, setProp] = useState(init.prop ?? "");
  const [cat, setCat] = useState(init.cat ?? "");
  const [rv, setRv] = useState(init.rv ?? "");
  const [my, setMy] = useState(mine ?? false);

  // What is applied now, as URL parameters. Custom dates are kept; presets roll forward with today.
  const applied: P = Object.fromEntries(Object.entries({
    range: init.range === "7d" ? "" : init.range, ...(init.range === "custom" ? { from: range.from, to: range.to } : {}),
    city: init.city, cluster: init.cluster, prop: init.prop, cat: init.cat, rv: init.rv, mine: mine === false ? "0" : "",
  }).filter(([, v]) => v)) as P;
  const go = (v: P) => router.push(`/dashboard?${new URLSearchParams(Object.entries(v).filter(([, x]) => x))}`);
  const apply = () => go({
    range: preset === "7d" ? "" : preset, ...(preset === "custom" ? { from, to } : {}), city, cluster, prop, cat, rv, mine: mine === undefined || my ? "" : "0",
  });
  const drop = (keys: string[]) => go(Object.fromEntries(Object.entries(applied).filter(([k]) => !keys.includes(k))));

  // Opening the dashboard with no filters in the link uses the default saved filters, if any.
  const def = views.find((v) => v.def);
  useEffect(() => { if (bare && def && !sameFilters(def.f, applied)) go(def.f as P); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cities = [...new Set(geo.map((g) => g.city))];
  const clusters = [...new Set(geo.filter((g) => !city || g.city === city).map((g) => g.cluster))];
  const props = geo.filter((g) => (!city || g.city === city) && (!cluster || g.cluster === cluster));
  const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const rvName = reviewers.find((r) => String(r.id) === init.rv)?.name ?? "";

  const chips: ActiveChip[] = [
    ...(init.range !== "7d" ? [{ key: "range", label: <>Dates: <b>{init.range === "custom" ? `${nice(range.from)} – ${nice(range.to)}` : PRESETS.find(([k]) => k === init.range)?.[1]}</b></>, clear: () => drop(["range", "from", "to"]) }] : []),
    ...(init.city ? [{ key: "city", label: <>City: <b>{init.city}</b></>, clear: () => drop(["city", "cluster", "prop"]) }] : []),
    ...(init.cluster ? [{ key: "cluster", label: <>Cluster: <b>{init.cluster}</b></>, clear: () => drop(["cluster", "prop"]) }] : []),
    ...(init.prop ? [{ key: "prop", label: <>Property: <b>{init.prop}</b></>, clear: () => drop(["prop"]) }] : []),
    ...(init.cat ? [{ key: "cat", label: <>Task type: <b>{init.cat}</b></>, clear: () => drop(["cat"]) }] : []),
    ...(init.rv ? [{ key: "rv", label: <>Reviewer: <b>{rvName}</b></>, clear: () => drop(["rv"]) }] : []),
    ...(mine === false ? [{ key: "mine", label: <>All reviewers&apos; properties</>, clear: () => drop(["mine"]) }] : []),
  ];
  const summary = [init.prop || init.cluster || init.city || "All properties", init.cat, rvName].filter(Boolean).join(" · ");

  return (
    <FilterBar chips={chips} onClearAll={() => go({})}
      saved={{ page: "dashboard", views, current: applied, apply: (f) => go(f as P), name: summary, notify,
        note: init.range === "custom" ? "Custom dates are saved as they are. Other date ranges move with today." : "The date range moves with today." }}
      foot={(close) => <button type="button" className="btn primary sm" disabled={preset === "custom" && (!from || !to || from > to)} onClick={() => { apply(); close(); }}>Apply filters</button>}
      panel={<>
        <Field label="Dates" wide>
          <div className="seg">{PRESETS.map(([k, l]) => <button key={k} type="button" aria-pressed={preset === k} onClick={() => setPreset(k)}>{l}</button>)}</div>
          {preset === "custom" && <div className="dates">
            <input type="date" id="dash-from" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><span className="muted">to</span>
            <input type="date" id="dash-to" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>}
        </Field>
        <Field label="City"><select id="dash-city" value={city} onChange={(e) => { setCity(e.target.value); setCluster(""); setProp(""); }}><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Cluster"><select id="dash-cluster" value={cluster} onChange={(e) => { setCluster(e.target.value); setProp(""); }}><option value="">All clusters</option>{clusters.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Property"><select id="dash-prop" value={prop} onChange={(e) => setProp(e.target.value)}><option value="">All properties</option>{props.map((p) => <option key={p.property}>{p.property}</option>)}</select></Field>
        {cats.length > 0 && <Field label="Task type"><select id="dash-cat" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All task types</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>}
        {reviewers.length > 0 && <Field label="Reviewer"><select id="dash-rv" value={rv} onChange={(e) => setRv(e.target.value)}><option value="">All reviewers</option>{reviewers.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}</select></Field>}
        {mine !== undefined && <Field label="Portfolio"><label className="switch" title="Only properties where you are the reviewer"><input type="checkbox" checked={my && !rv} disabled={!!rv} onChange={(e) => setMy(e.target.checked)} />My portfolio only</label></Field>}
      </>} />
  );
}
