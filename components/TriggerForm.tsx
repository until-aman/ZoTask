"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { triggerTask } from "@/app/actions";

export default function TriggerForm({ templates, properties }: { templates: { id: number; name: string; label: string }[]; properties: { id: number; name: string }[] }) {
  const router = useRouter();
  const [t, setT] = useState(templates[0]?.id ?? 0);
  const [p, setP] = useState(properties[0]?.id ?? 0);
  const [msg, setMsg] = useState("");
  if (!templates.length) return null;
  return (
    <section className="card grid" style={{ gap: 8 }}>
      <h2 style={{ margin: 0 }}>Trigger an event task</h2>
      <p className="small muted" style={{ margin: 0 }}>Stands in for events from the booking system, like a tenant exiting or a short stay being booked.</p>
      <div className="row2">
        <select value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Task">{templates.map((x) => <option key={x.id} value={x.id}>{x.label} → {x.name}</option>)}</select>
        <select value={p} onChange={(e) => setP(Number(e.target.value))} aria-label="Property">{properties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <button className="btn primary" onClick={async () => { const r = await triggerTask(t, p); setMsg(r.ok ? r.msg ?? "Created" : r.error); router.refresh(); }}>Create task</button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </section>
  );
}
