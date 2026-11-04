"use client";
// Admin → Week offs: the days the central team doesn't review, and how tasks submitted on those days are handled.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveOffDays } from "@/app/admin-actions";
import { isOff, offReason, type OffCfg } from "@/lib/offdays";
import { addDays, fmtDate } from "@/lib/time";

const NTH = ["1st", "2nd", "3rd", "4th", "5th"];

export default function WeekOffs({ cfg, today, counts, notify }: {
  cfg: OffCfg; today: string; counts: { must: number; auto: number; closed: number }; notify: (m: string) => void;
}) {
  const router = useRouter();
  const [c, setC] = useState<OffCfg>(cfg);
  const [hd, setHd] = useState({ date: "", name: "" });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<OffCfg>) => setC((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(c) !== JSON.stringify(cfg);
  const next: { d: string; why: string }[] = [];
  for (let d = today, i = 0; i < 120 && next.length < 8; d = addDays(d, 1), i++) if (isOff(c, d)) next.push({ d, why: offReason(c, d)! });
  async function save() {
    setBusy(true);
    const r = await saveOffDays(c);
    setBusy(false);
    notify(r.ok ? r.msg ?? "Saved" : r.error);
    if (r.ok) router.refresh();
  }
  return (
    <section className="card grid" style={{ gap: 12 }}>
      <div className="row2">
        <b>Days the whole review team is off</b>
        <label className="switch small"><input type="checkbox" checked={c.on} onChange={(e) => set({ on: e.target.checked })} />{c.on ? "On" : "Off: every day counts"}</label>
        <span className="spacer" />
        <span className="small muted">{dirty ? "Unsaved changes" : "Saved"}</span>
        {dirty && <button type="button" className="btn sm" onClick={() => setC(cfg)}>Undo</button>}
        <button type="button" className="btn primary sm" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <fieldset disabled={!c.on} className="grid" style={{ gap: 10, border: 0, padding: 0, margin: 0, opacity: c.on ? 1 : 0.55 }}>
        <div className="row2" style={{ flexWrap: "wrap", gap: "8px 16px" }}>
          <div className="te-days">
            <button type="button" aria-pressed={c.sundays} onClick={() => set({ sundays: !c.sundays })}>Sundays</button>
          </div>
          <div className="row2 small" style={{ gap: 6 }}>Saturdays
            <div className="te-days">{NTH.map((l, i) => (
              <button key={l} type="button" aria-pressed={c.saturdays.includes(i + 1)}
                onClick={() => set({ saturdays: c.saturdays.includes(i + 1) ? c.saturdays.filter((x) => x !== i + 1) : [...c.saturdays, i + 1].sort() })}>{l}</button>))}
            </div>
          </div>
        </div>
        <div className="row2" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="small">Holidays</span>
          {c.holidays.map((h) => (
            <span key={h.date} className="pill b" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>{fmtDate(h.date, { day: "numeric", month: "short" })}{h.name ? ` · ${h.name}` : ""}
              <button type="button" className="link" style={{ padding: 0, lineHeight: 1 }} aria-label={`Remove ${h.name || "holiday"}`} onClick={() => set({ holidays: c.holidays.filter((x) => x.date !== h.date) })}>×</button></span>
          ))}
          <form className="row2" style={{ gap: 6 }} onSubmit={(e) => {
            e.preventDefault(); if (!hd.date) return;
            set({ holidays: [...c.holidays.filter((x) => x.date !== hd.date), { date: hd.date, name: hd.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)) }); setHd({ date: "", name: "" });
          }}>
            <input type="date" value={hd.date} onChange={(e) => setHd({ ...hd, date: e.target.value })} aria-label="Holiday date" />
            <input type="text" value={hd.name} onChange={(e) => setHd({ ...hd, name: e.target.value })} placeholder="e.g. Diwali" aria-label="Holiday name" style={{ width: 140 }} />
            <button className="btn sm" disabled={!hd.date}>Add</button>
          </form>
        </div>
        <span className="small muted">Next: {c.on && next.length ? next.slice(0, 4).map((x) => `${fmtDate(x.d, { weekday: "short", day: "numeric", month: "short" })} (${x.why})`).join(" · ") : "none"}</span>
        <details className="small">
          <summary>How tasks sent in on these days are reviewed</summary>
          <div className="te-row" style={{ marginTop: 8 }}>
            <label className="f">Random check of the rest<select value={c.sample} onChange={(e) => set({ sample: Number(e.target.value) })}>
              {[0, 0.1, 0.2, 0.3, 0.5, 1].map((v) => <option key={v} value={v}>{Math.round(v * 100)}% of tasks</option>)}</select></label>
            <label className="f">Unchecked tasks close<select value={c.closeAfterH} onChange={(e) => set({ closeAfterH: Number(e.target.value) })}>
              {[24, 48, 72, 96].map((v) => <option key={v} value={v}>{v} hours after the team is back</option>)}</select></label>
            <label className="f">Pull back allowed for<select value={c.pullbackDays} onChange={(e) => set({ pullbackDays: Number(e.target.value) })}>
              {[0, 3, 7, 14, 30].map((v) => <option key={v} value={v}>{v ? `${v} days after closing` : "Not allowed"}</option>)}</select></label>
          </div>
          <p className="muted" style={{ margin: "8px 0 0" }}>Critical tasks, resubmissions and anything flagged must be checked, plus a random {Math.round(c.sample * 100)}% of the rest; the others close by themselves {c.closeAfterH} hours after the team is back. Time limits skip these days. Right now: {counts.must} must check · {counts.auto} optional · {counts.closed} auto-closed.</p>
        </details>
      </fieldset>
    </section>
  );
}
