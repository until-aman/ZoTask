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
    <section className="grid" style={{ gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>
        The days the central team doesn&apos;t review. Review and audit time limits don&apos;t count these days. Tasks submitted on them go to the
        reviewers&apos; <b>Weekend</b> list, where only some need a check. CBMs see nothing different: their task shows To Review and then Done, as on any other day.
      </p>
      <div className="card grid" style={{ gap: 14 }}>
        <label className="switch"><input type="checkbox" checked={c.on} onChange={(e) => set({ on: e.target.checked })} /> <b>Reviewer week offs are on</b></label>
        <fieldset disabled={!c.on} className="grid" style={{ gap: 14, border: 0, padding: 0, margin: 0, opacity: c.on ? 1 : 0.55 }}>
          <div className="te-row">
            <div className="f">Days off every week
              <div className="te-days">
                <button type="button" aria-pressed={c.sundays} onClick={() => set({ sundays: !c.sundays })}>Every Sunday</button>
              </div>
            </div>
            <div className="f">Saturdays off
              <div className="te-days">{NTH.map((l, i) => (
                <button key={l} type="button" aria-pressed={c.saturdays.includes(i + 1)}
                  onClick={() => set({ saturdays: c.saturdays.includes(i + 1) ? c.saturdays.filter((x) => x !== i + 1) : [...c.saturdays, i + 1].sort() })}>{l}</button>))}
              </div>
            </div>
          </div>
          <div className="f">Holidays
            <div className="lib-list" style={{ display: "grid", gap: 4 }}>
              {c.holidays.length ? c.holidays.map((h) => (
                <div key={h.date} className="lib-row row2"><b style={{ minWidth: 90 }}>{fmtDate(h.date, { day: "numeric", month: "short", year: "numeric" })}</b><span>{h.name || "Holiday"}</span><span className="spacer" />
                  <button type="button" className="link" onClick={() => set({ holidays: c.holidays.filter((x) => x.date !== h.date) })}>Remove</button></div>
              )) : <span className="small muted">No holidays added.</span>}
            </div>
            <form className="row2" style={{ marginTop: 6 }} onSubmit={(e) => {
              e.preventDefault(); if (!hd.date) return;
              set({ holidays: [...c.holidays.filter((x) => x.date !== hd.date), { date: hd.date, name: hd.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)) }); setHd({ date: "", name: "" });
            }}>
              <input type="date" value={hd.date} onChange={(e) => setHd({ ...hd, date: e.target.value })} aria-label="Holiday date" />
              <input type="text" value={hd.name} onChange={(e) => setHd({ ...hd, name: e.target.value })} placeholder="Name, e.g. Diwali" aria-label="Holiday name" style={{ flex: "1 1 180px" }} />
              <button className="btn sm" disabled={!hd.date}>Add holiday</button>
            </form>
          </div>
          <div className="te-row">
            <label className="f">Random check of the rest<select value={c.sample} onChange={(e) => set({ sample: Number(e.target.value) })}>
              {[0, 0.1, 0.2, 0.3, 0.5, 1].map((v) => <option key={v} value={v}>{Math.round(v * 100)}% of tasks</option>)}</select></label>
            <label className="f">Unchecked tasks close<select value={c.closeAfterH} onChange={(e) => set({ closeAfterH: Number(e.target.value) })}>
              {[24, 48, 72, 96].map((v) => <option key={v} value={v}>{v} hours after the team is back</option>)}</select></label>
            <label className="f">Pull back allowed for<select value={c.pullbackDays} onChange={(e) => set({ pullbackDays: Number(e.target.value) })}>
              {[0, 3, 7, 14, 30].map((v) => <option key={v} value={v}>{v ? `${v} days after closing` : "Not allowed"}</option>)}</select></label>
          </div>
        </fieldset>
        <div className="row2"><span className="small muted">{dirty ? "Unsaved changes" : "Saved"}</span><span className="spacer" />
          {dirty && <button type="button" className="btn sm" onClick={() => setC(cfg)}>Undo</button>}
          <button type="button" className="btn primary sm" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
      </div>

      <div className="grid g2">
        <div className="card grid" style={{ gap: 6 }}>
          <b>Next days off</b>
          {!c.on ? <span className="small muted">Week offs are off, so every day counts.</span> : next.length ? next.map((x) => (
            <div key={x.d} className="row2 small"><span style={{ minWidth: 120 }}>{fmtDate(x.d, { weekday: "short", day: "numeric", month: "short" })}</span><span className="muted">{x.why}</span></div>
          )) : <span className="small muted">No days off in the next four months.</span>}
        </div>
        <div className="card grid" style={{ gap: 6 }}>
          <b>How a day-off submission is handled</b>
          <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            <li><b>Must check:</b> critical tasks, resubmissions, and anything the system flags (missing evidence, submitted late, location not confirmed, a count below the ideal), plus a random {Math.round(c.sample * 100)}% of the rest.</li>
            <li><b>Optional:</b> everything else. A reviewer can still check it; otherwise it closes by itself {c.closeAfterH} hours after the team is back. The audit sample still applies.</li>
            <li><b>Pull back:</b> {c.pullbackDays ? `a reviewer can take an auto-closed task back into review for ${c.pullbackDays} days.` : "not allowed."}</li>
            <li>Time limits only count working days, so nothing shows as late because of a day off.</li>
          </ol>
          <span className="small muted">Right now: {counts.must} must check · {counts.auto} optional · {counts.closed} auto-closed in the pull-back window. See the Review Queue&apos;s Weekend and Auto-closed tabs.</span>
        </div>
      </div>
    </section>
  );
}
