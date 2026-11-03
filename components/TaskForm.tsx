"use client";
import { fmtTime } from "@/lib/time";
import { tryUpload } from "./upload";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startTask, submitTask, type Where } from "@/app/actions";
import Photo from "./Photo";

type Item = { id: number; label: string; kind: string; photo_required: number; note_required: number; photo_allowed: number; note_allowed: number; count_of: string | null };
type Prev = { item_id: number; checked: number; value: string | null; note: string | null; photos: string };
type Flag = { id: number; item_id: number; reason: string; comment: string | null };
type Ans = { checked: boolean; value: string; note: string; photos: string[]; reply: string };

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export default function TaskForm({ instanceId, items, status, attempt, attemptsAllowed, prev, flags, property, timer }: {
  instanceId: number; items: Item[]; status: string; attempt: number; attemptsAllowed: number; prev: Prev[]; flags: Flag[];
  property: { lat: number; lng: number; geofence: boolean; geofenceM: number };
  timer?: { startStop: boolean; startedAt: number | null; idealMinutes: number | null };
}) {
  const GEOFENCE_M = property.geofenceM;
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
  const KEY = `zotask.draft.${instanceId}.${attempt}`;
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
    setLoc({ ...loc, msg: "Checking…" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const d = distance({ lat: p.coords.latitude, lng: p.coords.longitude }, property);
        setLoc({ where: { lat: p.coords.latitude, lng: p.coords.longitude }, ok: d <= GEOFENCE_M, distance: d, msg: d <= GEOFENCE_M ? `You're at the property (${d} m away).` : `You're ${d >= 1000 ? (d / 1000).toFixed(1) + " km" : d + " m"} from the property. The reviewer will see a location warning.` });
      },
      () => setLoc({ ok: null, distance: null, msg: "Location permission was denied.", where: null }),
      { enableHighAccuracy: true, timeout: 10000 });
  }

  const problems = items.filter((it) => {
    const a = ans[it.id];
    return (it.kind === "check" ? !a.checked : !a.value) || (!!it.photo_required && !a.photos.length) || (!!it.note_required && !a.note);
  });

  async function onSubmit() {
    setErr("");
    if (pending) return setErr("Wait for the photos to finish uploading.");
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
      {items.map((it) => {
        const a = ans[it.id];
        const flag = flags.find((f) => f.item_id === it.id);
        return (
          <div key={it.id} className={`item${flag ? " flagged" : ""}`}>
            <div className="row2">
              {it.kind === "check" ? (
                <label className="row2" style={{ fontWeight: 700 }}>
                  <input type="checkbox" checked={a.checked} onChange={(e) => set(it.id, { checked: e.target.checked })} style={{ width: 18, height: 18 }} />
                  {it.label}
                </label>
              ) : <b>{it.label}</b>}
              <span className="spacer" />
              {it.photo_required ? <span className="pill">Photo needed</span> : null}
              {it.note_required ? <span className="pill">Note needed</span> : null}
            </div>
            {flag && <div className="small warn">Flagged: {flag.reason}{flag.comment ? ` · “${flag.comment}”` : ""}</div>}
            {it.kind === "count" && <label className="small muted">Number of {it.count_of === "SHK" ? "SHKs" : "HKs"} present<input type="number" min={0} value={a.value} onChange={(e) => set(it.id, { value: e.target.value })} style={{ width: 140, display: "block" }} aria-label={it.label} /></label>}
            {it.kind === "yesno" && <div className="seg" role="group" aria-label={it.label}>
              {["Yes", "No"].map((v) => <button key={v} type="button" aria-pressed={a.value === v} onClick={() => set(it.id, { value: v })}>{v}</button>)}
            </div>}
            {it.kind === "number" && <input type="number" min={0} value={a.value} onChange={(e) => set(it.id, { value: e.target.value })} style={{ width: 140 }} aria-label={it.label} />}
            {it.kind === "text" && <textarea value={a.value} onChange={(e) => set(it.id, { value: e.target.value })} aria-label={it.label} />}
            {!!(it.photo_allowed || it.photo_required) && <div className="photos">
              {a.photos.map((p, ix) => (
                <span key={p + ix} style={{ position: "relative" }}>
                  <Photo name={p} />
                  <button type="button" className="chip" style={{ position: "absolute", top: -6, right: -6, padding: 0, width: 20, height: 20, justifyContent: "center" }} aria-label="Remove photo"
                    onClick={() => set(it.id, { photos: a.photos.filter((_, j) => j !== ix) })}>×</button>
                </span>
              ))}
              {Array.from({ length: uploading[it.id] ?? 0 }, (_, k) => <span key={`up${k}`} className="ph" role="status" aria-label="Uploading photo">Uploading…</span>)}
              {a.photos.length + (uploading[it.id] ?? 0) < 10 && (
                <label className="ph" style={{ cursor: "pointer", borderStyle: "dashed" }}>
                  + Photo
                  <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { upload(it.id, e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>}
            {failed[it.id] && <div className="small warn" role="alert">{failed[it.id]}</div>}
            {!!(it.note_allowed || it.note_required) && <input type="text" placeholder={it.note_required ? "Note (required)" : "Note (optional)"} value={a.note} onChange={(e) => set(it.id, { note: e.target.value })} />}
            {flag && <input type="text" placeholder="Reply to the reviewer" value={a.reply} onChange={(e) => set(it.id, { reply: e.target.value })} />}
          </div>
        );
      })}
      {property.geofence && (
        <div className="row2">
          <button type="button" className="btn" onClick={checkLocation}>Validate location</button>
          <button type="button" className="link small" onClick={() => setLoc({ ok: null, distance: null, where: "simulated", msg: "Demo: location skipped. The reviewer will see it was simulated." })}>Simulate being on site (demo)</button>
          <span className={`small ${loc.ok === false ? "warn" : "muted"}`}>{loc.msg}</span>
        </div>
      )}
      {problems.length > 0 && <div className="info"><i>!</i>{problems.length} item{problems.length > 1 ? "s are" : " is"} incomplete. The reviewer can't pass a task with missing evidence.</div>}
      {err && <div className="err">{err}</div>}
      <div className="row2">
        <button type="button" className="btn primary" disabled={busy || pending > 0} onClick={onSubmit}>{busy ? "Submitting…" : pending ? `Uploading ${pending} photo${pending > 1 ? "s" : ""}…` : status === "changes" ? "Resubmit" : "Submit"}</button>
      </div>
    </div>
  );
}
