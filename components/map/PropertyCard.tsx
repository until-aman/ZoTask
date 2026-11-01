"use client";
// The property profile that opens when a pin or list row is clicked: contacts, amenities, what's nearby and the write-up.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Pin } from "@/lib/map";
import type { Details } from "@/lib/sheet";
import { km } from "@/lib/geo";
import { siteDetails } from "@/app/map-actions";

export const genderLabel = (g: string) => {
  const s = g.trim().toLowerCase();
  return !s ? "" : /^(men|male|boys?|gents)$/.test(s) ? "Men" : /^(women|female|girls?|ladies)$/.test(s) ? "Women" : /couple|co.?ed|unisex|both|mixed/.test(s) ? "Men & women" : g.trim();
};
const fmtKm = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);
const tel = (p: string) => p.split(/[,/]/)[0].replace(/[^\d+]/g, "");

/** Just enough Markdown for the sheet's write-ups: paragraphs, "* " bullet lists and **bold**. */
function Prose({ text }: { text: string }) {
  const inline = (s: string, k: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <b key={`${k}${i}`}>{part.slice(2, -2)}</b> : part));
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return <div className="prose">{blocks.map((b, i) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[*•-]\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^[*•-]\s+/, ""), `${i}.${j}.`)}</li>)}</ul>;
    if (lines.length === 1 && /^\*\*[^*]+\*\*:?$/.test(lines[0])) return <h4 key={i}>{lines[0].replace(/\*\*|:$/g, "")}</h4>;
    return <p key={i}>{lines.flatMap((l, j) => [j ? <br key={`br${j}`} /> : null, ...inline(l, `${i}.${j}.`)])}</p>;
  })}</div>;
}

const KIND: Record<string, string> = { train: "Train", bus: "Bus", metro: "Metro", airport: "Airport" };

export default function PropertyCard({ pin, pins, onClose, onPick }: { pin: Pin; pins: Pin[]; onClose: () => void; onPick: (p: Pin) => void }) {
  const [d, setD] = useState<Details | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    let live = true;
    setD(null);
    if (pin.siteId && pin.hasDetails) { setLoading(true); siteDetails(pin.siteId).then((r) => { if (live) { setD(r); setLoading(false); } }); }
    return () => { live = false; };
  }, [pin.siteId, pin.hasDetails]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const near = useMemo(() => pins.filter((p) => p.key !== pin.key).map((p) => ({ p, d: km(pin, p) })).sort((a, b) => a.d - b.d), [pin, pins]);
  const within2 = near.filter((n) => n.d <= 2).length;
  const copy = async (what: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopied(what); setTimeout(() => setCopied(""), 1500); } catch { /* clipboard blocked */ } };
  const g = genderLabel(d?.gender || pin.gender);
  const yes = d?.amenities?.filter((a) => a.yes) ?? [], no = d?.amenities?.filter((a) => !a.yes) ?? [];

  return (
    <aside className="drawer wide pcard" role="dialog" aria-label={`${pin.name} details`}>
      <div className="pc-hero">
        <div className="pc-top">
          <div className="pc-tags">
            {pin.code && <span className="pc-code mono">{pin.code}</span>}
            {g && <span className="pc-tag">{g}</span>}
            <span className={`pc-tag st-${pin.status.toLowerCase()}`}>{pin.status}</span>
          </div>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <h2>{pin.name}</h2>
        <p>{[pin.city, pin.state].filter(Boolean).join(", ")}{pin.cluster ? ` · ${pin.cluster} cluster` : ""}</p>
        <div className="pc-actions">
          <a className="btn sm primary" href={`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`} target="_blank" rel="noreferrer">Directions</a>
          <a className="btn sm" href={d?.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`} target="_blank" rel="noreferrer">Google Maps</a>
          {d?.photos && <a className="btn sm" href={d.photos} target="_blank" rel="noreferrer">Photos</a>}
          {pin.propertyId && <Link className="btn sm" href={`/dashboard?q=${encodeURIComponent(pin.name)}`}>Dashboard</Link>}
        </div>
      </div>

      <div className="db pc-body">
        <div className="pc-stats">
          {d?.staff !== undefined && <div><b className="mono">{d.staff}</b><span>On-site staff</span></div>}
          {d?.compliance !== undefined && <div><b className={`mono ${d.compliance >= 90 ? "t-g" : d.compliance >= 70 ? "t-a" : "t-r"}`}>{d.compliance}%</b><span>Compliance</span></div>}
          {pin.health && <div><b className="mono">{pin.health.onTime === null ? "–" : `${pin.health.onTime}%`}</b><span>Tasks on time, 7 days</span></div>}
          {pin.beds !== null && <div><b className="mono">{pin.beds}</b><span>Beds</span></div>}
          {near[0] && <div><b className="mono">{fmtKm(near[0].d)}</b><span>To nearest Zolo</span></div>}
          <div><b className="mono">{within2}</b><span>Zolo within 2 km</span></div>
        </div>

        {loading && <div className="small muted">Loading property details…</div>}

        {!!d?.contacts?.length && <section>
          <h3>Contacts</h3>
          <div className="pc-contacts">{d.contacts.map((c) => <div key={c.role} className="pc-person">
            <span className="pc-av" aria-hidden>{(c.name || c.role).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
            <span className="pc-pn"><b>{c.name || "Not named"}</b><span className="small muted">{c.role}{c.phone ? ` · ${c.phone}` : ""}</span></span>
            {c.phone && <span className="pc-pa">
              <a className="btn sm" href={`tel:${tel(c.phone)}`} aria-label={`Call ${c.name || c.role}`}>Call</a>
              <a className="btn sm" href={`https://wa.me/${tel(c.phone).length === 10 ? "91" : ""}${tel(c.phone).replace(/^\+/, "")}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${c.name || c.role}`}>WhatsApp</a>
            </span>}
          </div>)}</div>
        </section>}

        {pin.address && <section>
          <h3>Address</h3>
          <div className="pc-addr"><span>{pin.address}</span><button type="button" className="link small" onClick={() => copy("addr", pin.address)}>{copied === "addr" ? "Copied" : "Copy"}</button></div>
        </section>}

        {!!d?.amenities?.length && <section>
          <h3>Amenities</h3>
          <div className="pc-amen">
            {yes.map((a) => <span key={a.name} className="on"><i aria-hidden>✓</i>{a.name}</span>)}
            {no.map((a) => <span key={a.name} className="off"><i aria-hidden>–</i>{a.name}<span className="sr">: not available</span></span>)}
          </div>
        </section>}

        {(!!d?.transit?.length || !!d?.places?.length) && <section className="pc-two">
          {!!d?.transit?.length && <div>
            <h3>Getting there</h3>
            <ul className="pc-list">{d.transit.map((t) => <li key={t.kind + t.name}><span className={`pc-kind k-${t.kind}`}>{KIND[t.kind] ?? t.kind}</span><span className="pc-ln">{t.name}</span>{t.dist && <span className="mono small">{t.dist}</span>}</li>)}</ul>
          </div>}
          {!!d?.places?.length && <div>
            <h3>Demand centres nearby</h3>
            <ul className="pc-list">{d.places.map((p, i) => <li key={i}><span className="pc-num mono">{i + 1}</span><span className="pc-ln">{p.name}</span>{p.dist && <span className="mono small">{p.dist}</span>}</li>)}</ul>
          </div>}
        </section>}

        {near.length > 0 && <section>
          <h3>Nearest Zolo properties</h3>
          <ul className="pc-list">{near.slice(0, 5).map(({ p, d: dist }) => <li key={p.key}>
            <button type="button" className="pc-near" onClick={() => onPick(p)}><span className="pc-ln"><b>{p.name}</b>{p.city !== pin.city && <span className="small muted"> · {p.city}</span>}</span><span className="mono small">{fmtKm(dist)}</span></button>
          </li>)}</ul>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Straight-line distance.</p>
        </section>}

        {d?.about && <section><h3>About the property</h3><Prose text={d.about} /></section>}
        {d?.description && <details className="pc-more"><summary>Listing description</summary><Prose text={d.description} /></details>}
        {d?.remarks && <section><h3>Remarks</h3><p className="small" style={{ margin: 0 }}>{d.remarks}</p></section>}
        {!pin.hasDetails && <p className="small muted" style={{ margin: 0 }}>No profile uploaded for this property yet. Upload the property sheet from the Map tab to add contacts, amenities and what&apos;s nearby.</p>}
      </div>
    </aside>
  );
}
