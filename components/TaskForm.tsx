"use client";
import "@/lib/storage";
import { fmtTime } from "@/lib/time";
import { answerIssue, choicesFor, needs, nonNegative } from "@/lib/answers";
import { tryUpload } from "./upload";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startTask, submitTask, type Where } from "@/app/actions";
import Photo from "./Photo";

type Item = { id: number; label: string; kind: string; photo_required: number; note_required: number; photo_allowed: number; note_allowed: number; count_of: string | null; options?: string | null; option_rules?: string | null };
type Prev = { item_id: number; checked: number; value: string | null; note: string | null; photos: string };
type Flag = { id: number; item_id: number; reason: string; comment: string | null };
type Ans = { checked: boolean; value: string; note: string; photos: string[]; reply: string };

function distance(a: { lat: number; lng: number }, b: { lat: number | null; lng: number | null }) {
  if (b.lat == null || b.lng == null) return NaN;
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export default function TaskForm({ instanceId, items, status, attempt, attemptsAllowed, prev, flags, property, timer }: {
  instanceId: number; items: Item[]; status: string; attempt: number; attemptsAllowed: number; prev: Prev[]; flags: Flag[];
  property: { lat: number | null; lng: number | null; geofence: boolean; geofenceM: number };
  timer?: { startStop: boolean; startedAt: number | null; idealMinutes: number | null };
}) {
  const GEOFENCE_M = property.geofenceM, ROUGH_M = 1000;
  const router = useRouter();
  const [ans, setAns] = useState<Record<number, Ans>>(() => Object.fromEntries(items.map((it) => {
    const p = prev.find((x) => x.item_id === it.id);
    return [it.id, { checked: !!p?.checked, value: p?.value ?? "", note: p?.note ?? "", photos: p ? JSON.parse(p.photos) : [], reply: "" }];
  })));
  const [loc, setLoc] = useState<{ ok: boolean | null; distance: number | null; msg: string; where: Where }>({ ok: null, distance: null, msg: "", where: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [locWarned, setLocWarned] = useState(false);
  const [startedAt, setStartedAt] = useState(timer?.startedAt ?? null);
  async function start() {
    const r = await startTask(instanceId);
    if (!r.ok) return setErr(r.error);
    setStartedAt(Date.now());
  }
  const set = (id: number, patch: Partial<Ans>) => setAns((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  // Unsent answers are kept on this phone, so a refresh, a call or a dropped connection doesn't lose them.
  const KEY = `tasktrail.draft.${instanceId}.${attempt}`;
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<number, Ans> | null;
      if (saved && items.some((it) => JSON.stringify(saved[it.id]) !== JSON.stringify(ans[it.id]))) {
        setAns((s) => Object.fromEntries(items.map((it) => [it.id, saved[it.id] ? { ...s[it.id], ...saved[it.id] } : s[it.id]])));
        setRestored(true);
      }
    } catch { /* storage blocked */ }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [KEY]);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(ans)); } catch { /* storage full or blocked */ } }, 400);
    return () => clearTimeout(t);
  }, [ans, KEY]);
  function discardDraft() {
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    window.location.reload();
  }

  // Photos being uploaded and the ones that failed, per item.
  const [uploading, setUploading] = useState<Record<number, number>>({});
  const [failed, setFailed] = useState<Record<number, string>>({});
  const pending = Object.values(uploading).reduce((a, b) => a + b, 0);
  async function upload(id: number, files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10 - ans[id].photos.length);
    setFailed((f) => ({ ...f, [id]: "" }));
    setUploading((u) => ({ ...u, [id]: (u[id] ?? 0) + list.length }));
    await Promise.all(list.map(async (f) => {
      const r = await tryUpload(f);
      if ("name" in r) setAns((s) => ({ ...s, [id]: { ...s[id], photos: [...s[id].photos, r.name].slice(0, 10) } }));
      else setFailed((x) => ({ ...x, [id]: `${f.name}: ${r.error}` }));
      setUploading((u) => ({ ...u, [id]: (u[id] ?? 1) - 1 }));
    }));
  }

  function checkLocation() {
    if (!navigator.geolocation) return setLoc({ ok: null, distance: null, msg: "This browser can't share location.", where: null });
    if (property.lat == null || property.lng == null) return setLoc({ ok: null, distance: null, msg: "This property has no map location yet, so the distance can't be checked. Ask an admin to set it on the Map.", where: null });
    setLoc({ ...loc, msg: "Checking…" });
    const far = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
        const d = distance(here, property);
        // A laptop or a phone with location services off often gives only a rough area from the internet connection (or a VPN's country),
        // which can be hundreds or thousands of km out. Say so instead of calling it a real distance.
        if (here.acc > ROUGH_M) return setLoc({ where: here, ok: null, distance: d, msg: `Your device only gave a rough area (accurate to about ${far(here.acc)}), not your exact spot. Turn on location services or GPS, switch off any VPN, then tap Validate location again. Phones work best.` });
        setLoc({ where: here, ok: d <= GEOFENCE_M, distance: d, msg: d <= GEOFENCE_M ? `You're at the property (${d} m away).` : `You're ${far(d)} from the property. The reviewer will see a location warning.` });
      },
      (e) => setLoc({ ok: null, distance: null, where: null, msg: e.code === 1 ? "Location permission was denied. Allow location for this site in the browser, then try again." : "Couldn't get your location. Check that location services are on, then try again." }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  // What's still missing per item. Shown under each item once Submit was pressed, or as soon as an item has been touched.
  const issues = Object.fromEntries(items.map((it) => [it.id, answerIssue(it, ans[it.id], flags.some((f) => f.item_id === it.id))]));
  const problems = items.filter((it) => issues[it.id]);
  // With Start/Stop on, nothing can be filled in until the task is started.
  const locked = !!timer?.startStop && status !== "changes" && !startedAt;
  const [tried, setTried] = useState(false);

  async function onSubmit() {
    setErr("");
    if (pending) return setErr("Wait for the photos to finish uploading.");
    if (problems.length) {
      setTried(true);
      document.getElementById(`item-${problems[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return setErr(`${problems.length === 1 ? "1 item needs" : `${problems.length} items need`} attention before you can submit.`);
    }
    if (property.geofence && !loc.where && !locWarned) {
      setLocWarned(true);
      return setErr("Location hasn't been checked. Validate it, or press Submit again to send without it. The reviewer will see that.");
    }
    setBusy(true);
    const r = await submitTask(instanceId, items.map((it) => ({ itemId: it.id, ...ans[it.id] })), loc.where);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    router.push("/tasks");
    router.refresh();
  }

  return (
    <div className="card grid">
      {timer?.startStop && status !== "changes" && (
        <div className="row2 timerbar">
          {startedAt ? <span>Started at <b>{fmtTime(startedAt)}</b>. Submitting stops the clock.</span>
            : <><button type="button" className="btn primary" onClick={start}>Start task</button><span className="small muted">Tap Start when you begin, so time spent is tracked.</span></>}
          {timer.idealMinutes ? <><span className="spacer" /><span className="pill">Ideal: {timer.idealMinutes} min</span></> : null}
        </div>
      )}
      {restored && (
        <div className="info row2" role="status"><i>i</i><span>Restored the answers you hadn&apos;t sent yet.</span><span className="spacer" /><button type="button" className="link small" onClick={discardDraft}>Start over</button></div>
      )}
      {status === "changes" && (
        <div className="err" style={{ fontWeight: 600 }}>The reviewer sent this back. Fix the flagged items and reply to each flag. This will be attempt {attempt + 1} of {attemptsAllowed}{attempt + 1 === attemptsAllowed ? ", your last one" : ""}.</div>
      )}
      {status === "notsub" && <div className="err" style={{ fontWeight: 600 }}>The window has closed. You can still submit, but it will count as late.</div>}
      {locked && <div className="info" role="status"><i>!</i><span>Tap Start task first. The checklist unlocks once the task is started.</span></div>}
      <div className="tf-prog" aria-live="polite">
        <span><b>{items.length - problems.length} of {items.length}</b> items complete</span>
        <div className="tf-bar" aria-hidden="true"><i style={{ width: `${items.length ? ((items.length - problems.length) / items.length) * 100 : 0}%` }} /></div>
      </div>
      <fieldset className="items" disabled={locked} aria-disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: locked ? 0.55 : 1 }}>
      {items.map((it, ix) => {
        const a = ans[it.id];
        const flag = flags.find((f) => f.item_id === it.id);
        const need = needs(it, a);
        const done = !issues[it.id];
        const hasPhoto = a.photos.length > 0, hasNote = !!a.note.trim();
        const showNote = !!(it.note_allowed || need.note || (it.kind === "check" && !a.checked));
        const show = (it.photo_allowed || need.photo);
        return (
          <div key={it.id} id={`item-${it.id}`} className={`item tf-item${flag ? " flagged" : ""}${tried && !done ? " missing" : ""}${done ? " done" : ""}`}>
            <span className="tf-n" aria-label={done ? `Item ${ix + 1}, complete` : `Item ${ix + 1}`}>{done ? "✓" : ix + 1}</span>
            <div className="tf-body">
              <div className="tf-q">{it.label}</div>
              {flag && <div className="tf-flag">Flagged by the reviewer: <b>{flag.reason}</b>{flag.comment ? ` · “${flag.comment}”` : ""}</div>}
              <div className="ansrow">
                {it.kind === "check" && (
                  <label className={`tf-tick${a.checked ? " on" : ""}`}>
                    <input type="checkbox" checked={a.checked} onChange={(e) => set(it.id, { checked: e.target.checked })} />
                    {a.checked ? "Done" : "Mark as done"}
                  </label>
                )}
                {it.kind === "count" && <label className="small muted">Number of {it.count_of === "SHK" ? "SHKs" : "HKs"} present<input type="text" inputMode="numeric" pattern="[0-9]*" value={a.value} onChange={(e) => set(it.id, { value: nonNegative(e.target.value, true) })} style={{ width: 140, display: "block" }} aria-label={it.label} placeholder="0 or more" /></label>}
                {choicesFor(it) && <div className="seg seg-wrap" role="group" aria-label={it.label}>
                  {choicesFor(it)!.map((v) => <button key={v} type="button" aria-pressed={a.value === v} onClick={() => set(it.id, { value: v })}>{v}</button>)}
                </div>}
                {it.kind === "number" && <input type="text" inputMode="decimal" value={a.value} onChange={(e) => set(it.id, { value: nonNegative(e.target.value) })} style={{ width: 140 }} aria-label={it.label} placeholder="0 or more" />}
                {it.kind === "text" && <textarea value={a.value} onChange={(e) => set(it.id, { value: e.target.value })} aria-label={it.label} placeholder="Your answer" />}
              </div>
              {!!show && (
                <div className={`tf-sec${need.photo ? (hasPhoto ? " ok" : " req") : ""}`}>
                  <div className="tf-sec-h">Photo
                    {need.photo ? <span className={`tf-tag ${hasPhoto ? "ok" : "req"}`}>{hasPhoto ? "✓ Added" : "Compulsory"}</span> : <span className="tf-tag">Optional</span>}
                  </div>
                  <div className="photos">
                    {a.photos.map((p, j) => (
                      <span key={p + j} style={{ position: "relative" }}>
                        <Photo name={p} />
                        <button type="button" className="chip" style={{ position: "absolute", top: -6, right: -6, padding: 0, width: 20, height: 20, justifyContent: "center" }} aria-label="Remove photo"
                          onClick={() => set(it.id, { photos: a.photos.filter((_, k) => k !== j) })}>×</button>
                      </span>
                    ))}
                    {Array.from({ length: uploading[it.id] ?? 0 }, (_, k) => <span key={`up${k}`} className="ph" role="status" aria-label="Uploading photo">Uploading…</span>)}
                    {a.photos.length + (uploading[it.id] ?? 0) < 10 && (
                      <label className="ph tf-add">
                        + Photo
                        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { upload(it.id, e.target.files); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  {failed[it.id] && <div className="small warn" role="alert">{failed[it.id]}</div>}
                </div>
              )}
              {showNote && (
                <div className={`tf-sec${need.note || (tried && it.kind === "check" && !a.checked) ? (hasNote ? " ok" : " req") : ""}`}>
                  <div className="tf-sec-h">Note
                    {need.note ? <span className={`tf-tag ${hasNote ? "ok" : "req"}`}>{hasNote ? "✓ Added" : "Compulsory"}</span>
                      : it.kind === "check" && !a.checked ? <span className={`tf-tag${tried && !hasNote ? " req" : ""}`}>Needed if not done</span> : <span className="tf-tag">Optional</span>}
                  </div>
                  <input type="text" aria-label={`Note for ${it.label}`} placeholder={it.kind === "check" && !a.checked && !need.note ? "Not done? Say why" : "Write a note"} value={a.note} onChange={(e) => set(it.id, { note: e.target.value })} />
                </div>
              )}
              {flag && <div className={`tf-sec ${a.reply.trim() ? "ok" : "req"}`}>
                <div className="tf-sec-h">Reply to the reviewer<span className={`tf-tag ${a.reply.trim() ? "ok" : "req"}`}>{a.reply.trim() ? "✓ Added" : "Compulsory"}</span></div>
                <input type="text" aria-label="Reply to the reviewer" placeholder="What did you fix?" value={a.reply} onChange={(e) => set(it.id, { reply: e.target.value })} />
              </div>}
              {tried && issues[it.id] && <div className="tf-issue" role="alert">{issues[it.id]}</div>}
            </div>
          </div>
        );
      })}
      </fieldset>
      {property.geofence && (
        <div className="row2">
          <button type="button" className="btn" disabled={locked} onClick={checkLocation}>Validate location</button>
          <button type="button" className="link small" disabled={locked} onClick={() => setLoc({ ok: null, distance: null, where: "simulated", msg: "Demo: location skipped. The reviewer will see it was simulated." })}>Simulate being on site (demo)</button>
          <span className={`small ${loc.ok === false ? "warn" : "muted"}`}>{loc.msg}</span>
        </div>
      )}
      {problems.length > 0 && <div className="info"><i>!</i>{problems.length} item{problems.length > 1 ? "s are" : " is"} still incomplete. Compulsory photos and notes, and an answer to every question, are needed to submit.</div>}
      {err && <div className="err">{err}</div>}
      <div className="row2">
        <button type="button" className="btn primary" disabled={busy || pending > 0 || locked} onClick={onSubmit}>{busy ? "Submitting…" : pending ? `Uploading ${pending} photo${pending > 1 ? "s" : ""}…` : status === "changes" ? "Resubmit" : "Submit"}</button>
      </div>
    </div>
  );
}
