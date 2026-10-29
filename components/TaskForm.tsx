"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitTask } from "@/app/actions";
import Photo from "./Photo";

type Item = { id: number; label: string; kind: string; photo_required: number; note_required: number };
type Prev = { item_id: number; checked: number; value: string | null; note: string | null; photos: string };
type Flag = { id: number; item_id: number; reason: string; comment: string | null };
type Ans = { checked: boolean; value: string; note: string; photos: string[]; reply: string };

const GEOFENCE_M = 200;
function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export default function TaskForm({ instanceId, items, status, attempt, attemptsAllowed, prev, flags, property }: {
  instanceId: number; items: Item[]; status: string; attempt: number; attemptsAllowed: number; prev: Prev[]; flags: Flag[];
  property: { lat: number; lng: number; geofence: boolean };
}) {
  const router = useRouter();
  const [ans, setAns] = useState<Record<number, Ans>>(() => Object.fromEntries(items.map((it) => {
    const p = prev.find((x) => x.item_id === it.id);
    return [it.id, { checked: !!p?.checked, value: p?.value ?? "", note: p?.note ?? "", photos: p ? JSON.parse(p.photos) : [], reply: "" }];
  })));
  const [loc, setLoc] = useState<{ ok: boolean | null; distance: number | null; msg: string }>({ ok: null, distance: null, msg: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (id: number, patch: Partial<Ans>) => setAns((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  async function upload(id: number, files: FileList | null) {
    if (!files) return;
    const names: string[] = [];
    for (const f of Array.from(files).slice(0, 10 - ans[id].photos.length)) {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) names.push((await res.json()).name);
    }
    set(id, { photos: [...ans[id].photos, ...names] });
  }

  function checkLocation() {
    if (!navigator.geolocation) return setLoc({ ok: null, distance: null, msg: "This browser can't share location." });
    setLoc({ ...loc, msg: "Checking…" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const d = distance({ lat: p.coords.latitude, lng: p.coords.longitude }, property);
        setLoc({ ok: d <= GEOFENCE_M, distance: d, msg: d <= GEOFENCE_M ? `You're at the property (${d} m away).` : `You're ${d >= 1000 ? (d / 1000).toFixed(1) + " km" : d + " m"} from the property. The reviewer will see a location warning.` });
      },
      () => setLoc({ ok: null, distance: null, msg: "Location permission was denied." }),
      { enableHighAccuracy: true, timeout: 10000 });
  }

  const problems = items.filter((it) => {
    const a = ans[it.id];
    return (it.kind === "check" ? !a.checked : !a.value) || (it.photo_required && !a.photos.length) || (it.note_required && !a.note);
  });

  async function onSubmit() {
    setErr("");
    if (property.geofence && loc.ok === null && !confirm("Location hasn't been checked. Submit anyway? The reviewer will see that.")) return;
    setBusy(true);
    const r = await submitTask(instanceId, items.map((it) => ({ itemId: it.id, ...ans[it.id] })), { ok: loc.ok, distance: loc.distance });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.push("/tasks");
    router.refresh();
  }

  return (
    <div className="card grid">
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
            {it.kind === "number" && <input type="number" min={0} value={a.value} onChange={(e) => set(it.id, { value: e.target.value })} style={{ width: 140 }} aria-label={it.label} />}
            {it.kind === "text" && <textarea value={a.value} onChange={(e) => set(it.id, { value: e.target.value })} aria-label={it.label} />}
            <div className="photos">
              {a.photos.map((p, ix) => (
                <span key={p + ix} style={{ position: "relative" }}>
                  <Photo name={p} />
                  <button type="button" className="chip" style={{ position: "absolute", top: -6, right: -6, padding: 0, width: 20, height: 20, justifyContent: "center" }} aria-label="Remove photo"
                    onClick={() => set(it.id, { photos: a.photos.filter((_, j) => j !== ix) })}>×</button>
                </span>
              ))}
              {a.photos.length < 10 && (
                <label className="ph" style={{ cursor: "pointer", borderStyle: "dashed" }}>
                  + Photo
                  <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => upload(it.id, e.target.files)} />
                </label>
              )}
            </div>
            <input type="text" placeholder={it.note_required ? "Note (required)" : "Note (optional)"} value={a.note} onChange={(e) => set(it.id, { note: e.target.value })} />
            {flag && <input type="text" placeholder="Reply to the reviewer" value={a.reply} onChange={(e) => set(it.id, { reply: e.target.value })} />}
          </div>
        );
      })}
      {property.geofence && (
        <div className="row2">
          <button type="button" className="btn" onClick={checkLocation}>Validate location</button>
          <button type="button" className="link small" onClick={() => setLoc({ ok: true, distance: 0, msg: "Simulated: you're at the property." })}>Simulate being on site</button>
          <span className={`small ${loc.ok === false ? "warn" : "muted"}`}>{loc.msg}</span>
        </div>
      )}
      {problems.length > 0 && <div className="info"><i>!</i>{problems.length} item{problems.length > 1 ? "s are" : " is"} incomplete. The reviewer can't pass a task with missing evidence.</div>}
      {err && <div className="err">{err}</div>}
      <div className="row2">
        <button type="button" className="btn primary" disabled={busy} onClick={onSubmit}>{busy ? "Submitting…" : status === "changes" ? "Resubmit" : "Submit"}</button>
      </div>
    </div>
  );
}
