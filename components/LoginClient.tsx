"use client";
// Sign in: one search over everyone, office roles in small cards, and the ground team grouped by property.
import { useEffect, useState } from "react";
import { signIn } from "@/app/actions";

export type Person = { id: number; name: string; role: string; op: string | null; props: string | null; city: string | null; cluster: string | null };

const OFFICE: [string, string, string][] = [
  ["admin", "Admin", "Sets up tasks, properties and people"],
  ["reviewer", "Central reviewers", "Pass or send back submitted tasks"],
  ["auditor", "Auditors", "Re-check a sample of passed tasks"],
  ["cbm", "Cluster Business Managers", "Own properties, answer audit flags"],
];
const LAST = "zotask.lastUser";

function Pick({ p, sub }: { p: Person; sub?: string }) {
  return (
    <form action={signIn} onSubmit={() => { try { localStorage.setItem(LAST, String(p.id)); } catch { /* private mode */ } }}>
      <input type="hidden" name="id" value={p.id} />
      <button className="lg-pick" title={p.props ?? ""}>{p.name}{sub && <small>{sub}</small>}</button>
    </form>
  );
}

export default function LoginClient({ people }: { people: Person[] }) {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [last, setLast] = useState<Person | null>(null);
  useEffect(() => {
    try { const id = Number(localStorage.getItem(LAST)); setLast(people.find((p) => p.id === id) ?? null); } catch { /* private mode */ }
  }, [people]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const title = (r: string) => OFFICE.find(([k]) => k === r)?.[1] ?? "Ground team";
  const hit = (p: Person) => words.every((w) => [p.name, p.op, p.props, p.city, p.cluster, title(p.role)].some((x) => x?.toLowerCase().includes(w)));
  const shown = people.filter(hit);
  const ground = shown.filter((p) => p.role === "ground" && (!city || p.city === city));
  const cities = [...new Set(people.filter((p) => p.role === "ground" && p.city).map((p) => p.city!))].sort();
  const byProp = [...ground.reduce((m, p) => m.set(p.props ?? "No property", [...(m.get(p.props ?? "No property") ?? []), p]), new Map<string, Person[]>())];
  const office = OFFICE.map(([k, t, b]) => [t, b, shown.filter((p) => p.role === k)] as const).filter(([, , l]) => l.length);

  return (
    <div className="page narrow lg">
      <div>
        <h1>Sign in to ZoTask</h1>
        <p className="muted" style={{ margin: "2px 0 0" }}>Sample data. Pick anyone to see ZoTask from their side.</p>
      </div>
      <div className="lg-top">
        <input type="search" className="search grow" placeholder="Search name, property, city or role" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" autoFocus />
        {last && !q && <form action={signIn}><input type="hidden" name="id" value={last.id} /><button className="btn primary">Continue as {last.name}</button></form>}
      </div>

      {office.length > 0 && <div className="lg-office">
        {office.map(([t, b, l]) => (
          <section key={t} className="card lg-card">
            <h2>{t} <span className="muted small">{l.length}</span></h2>
            <p className="muted small">{b}</p>
            <div className="lg-names">{l.map((p) => <Pick key={p.id} p={p} />)}</div>
          </section>
        ))}
      </div>}

      {(ground.length > 0 || (city && shown.some((p) => p.role === "ground"))) && <section className="lg-ground">
        <div className="row2">
          <div><h2 style={{ margin: 0 }}>Ground team <span className="muted small">{ground.length}</span></h2>
            <p className="muted small" style={{ margin: "2px 0 0" }}>Daily checklists at a property</p></div>
          <span className="spacer" />
          {cities.length > 1 && <div className="seg" role="group" aria-label="City">
            <button type="button" aria-pressed={!city} onClick={() => setCity("")}>All cities</button>
            {cities.map((c) => <button key={c} type="button" aria-pressed={city === c} onClick={() => setCity(c)}>{c}</button>)}
          </div>}
        </div>
        <div className="lg-props">
          {byProp.map(([prop, l]) => (
            <section key={prop} className="card lg-card">
              <h3>{prop}</h3>
              <p className="muted small">{[l[0].cluster, l[0].city].filter(Boolean).join(" · ")}</p>
              <div className="lg-names col">{l.map((p) => <Pick key={p.id} p={p} sub={p.op ?? ""} />)}</div>
            </section>
          ))}
        </div>
      </section>}

      {!shown.length && <div className="card empty"><b>No one matches</b>Try a first name, a property or a role like &quot;HK&quot;.</div>}
    </div>
  );
}
