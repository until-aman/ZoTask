"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { auditTask, closeFlags, reopenTask, reviewTask, waiveTask } from "@/app/actions";
import Photo from "./Photo";

const REASONS = ["Photo missing", "Photo unclear", "Wrong location", "Count mismatch", "Item not done", "Other"];
type Item = { id: number; label: string; kind: string; photo_required: number; note_required: number };
type Ans = { checked: number; value: string | null; note: string | null; photos: string[]; reply: string | null };
type Flag = { id: number; item_id: number; reason: string; comment: string | null; answer: string | null };

function Shown({ it, a }: { it: Item; a?: Ans }) {
  if (!a) return <span className="warn">Not recorded</span>;
  const main = it.kind === "check" ? (a.checked ? "Done" : <span className="warn">Not done</span>) : a.value ? a.value : <span className="warn">Not recorded</span>;
  return (
    <div className="grid" style={{ gap: 6 }}>
      <div>{main}{it.photo_required && !a.photos.length ? <> · <span className="warn">Photo not recorded</span></> : null}</div>
      {a.photos.length > 0 && <div className="photos">{a.photos.map((p, i) => <Photo key={i} name={p} />)}</div>}
      {a.note && <div className="small muted">Note: {a.note}</div>}
      {a.reply && <div className="small" style={{ color: "var(--blue-d)" }}>Reply: {a.reply}</div>}
    </div>
  );
}

export default function ReviewForm({ instanceId, mode, items, latest, previous, prevFlags, auditFlags, missing }: {
  instanceId: number; mode: string; items: Item[]; latest: Record<number, Ans>; previous: Record<number, Ans> | null;
  prevFlags: Flag[]; auditFlags: Flag[]; missing: number[];
}) {
  const router = useRouter();
  const [opened] = useState(() => Date.now());
  const [flags, setFlags] = useState<Record<number, { reason: string; comment: string } | undefined>>(() =>
    Object.fromEntries(missing.map((id) => [id, { reason: items.find((i) => i.id === id)?.photo_required ? "Photo missing" : "Item not done", comment: "" }])));
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const flagList = Object.entries(flags).filter(([, v]) => v).map(([k, v]) => ({ itemId: Number(k), reason: v!.reason, comment: v!.comment }));
  const actOn = mode === "review" || mode === "audit";

  async function go(p: Promise<{ ok: boolean; error?: string; msg?: string }>) {
    setBusy(true); setErr("");
    const r = await p;
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "Something went wrong");
    router.refresh();
  }

  if (mode === "waive") {
    return (
      <div className="card row2">
        <span>Not happening today? Waive it so it isn't counted as missed.</span><span className="spacer" />
        <input type="text" placeholder="Reason, e.g. property under renovation" value={comment} onChange={(e) => setComment(e.target.value)} style={{ flex: "1 1 220px" }} aria-label="Reason for waiving" />
        <button className="btn" disabled={!comment.trim() || busy} onClick={() => go(waiveTask(instanceId, comment.trim()))}>Waive task</button>
        {err && <div className="err">{err}</div>}
      </div>
    );
  }

  return (
    <div className="card grid">
      <div className="row2">
        <h2 style={{ margin: 0 }}>{mode === "audit" ? "Audit" : "Review"} sheet</h2>
        <span className="spacer" />
        {actOn && <span className="small muted">Mark each item OK or flag it with a reason.</span>}
      </div>
      {items.map((it) => {
        const f = flags[it.id];
        const pf = prevFlags.find((x) => x.item_id === it.id);
        const af = auditFlags.find((x) => x.item_id === it.id);
        return (
          <div key={it.id} className={`item${f || af ? " flagged" : ""}`}>
            <div className="row2">
              <b>{it.label}</b>
              {missing.includes(it.id) && <span className="pill r">Missing evidence</span>}
              <span className="spacer" />
              {actOn && (
                <div className="seg">
                  <button type="button" aria-pressed={!f} onClick={() => setFlags({ ...flags, [it.id]: undefined })} disabled={missing.includes(it.id)}>OK</button>
                  <button type="button" aria-pressed={!!f} onClick={() => setFlags({ ...flags, [it.id]: f ?? { reason: REASONS[1], comment: "" } })}>Flag</button>
                </div>
              )}
            </div>
            {previous && pf ? (
              <div className="cmp">
                <div><div className="small muted">Previous attempt · flagged “{pf.reason}”</div><Shown it={it} a={previous[it.id]} /></div>
                <div><div className="small muted">This attempt</div><Shown it={it} a={latest[it.id]} /></div>
              </div>
            ) : <Shown it={it} a={latest[it.id]} />}
            {af && <div className="small"><span className="warn">Audit flag: {af.reason}{af.comment ? ` · “${af.comment}”` : ""}</span>{af.answer && <><br />CBM answer: {af.answer}</>}</div>}
            {f && (
              <div className="row2">
                <select value={f.reason} onChange={(e) => setFlags({ ...flags, [it.id]: { ...f, reason: e.target.value } })} aria-label="Reason">
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                <input type="text" placeholder="What needs fixing?" value={f.comment} onChange={(e) => setFlags({ ...flags, [it.id]: { ...f, comment: e.target.value } })} style={{ flex: 1 }} />
              </div>
            )}
          </div>
        );
      })}
      {actOn && <input type="text" placeholder="Overall comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />}
      {err && <div className="err">{err}</div>}
      <div className="row2">
        {mode === "review" && <>
          <button className="btn primary" disabled={busy || flagList.length > 0} title={flagList.length ? "Clear the flags to pass" : ""} onClick={() => go(reviewTask(instanceId, "pass", [], comment, opened))}>Pass</button>
          <button className="btn danger" disabled={busy || !flagList.length} onClick={() => go(reviewTask(instanceId, "changes", flagList, comment, opened))}>Request changes ({flagList.length})</button>
        </>}
        {mode === "audit" && <>
          <button className="btn primary" disabled={busy || flagList.length > 0} onClick={() => go(auditTask(instanceId, "pass", [], comment))}>Audit pass</button>
          <button className="btn danger" disabled={busy || !flagList.length} onClick={() => go(auditTask(instanceId, "fail", flagList, comment))}>Audit fail ({flagList.length})</button>
        </>}
        {mode === "closeflags" && <>
          <button className="btn primary" disabled={busy} onClick={() => go(closeFlags(instanceId, true))}>Accept answers and close</button>
          <button className="btn danger" disabled={busy} onClick={() => go(closeFlags(instanceId, false))}>Send back to CBM</button>
        </>}
        {mode === "reopen" && <button className="btn" disabled={busy} onClick={() => go(reopenTask(instanceId))}>Reopen for review</button>}
        {mode === "view" && <span className="muted small">You can view this task, but it isn't waiting on you.</span>}
      </div>
    </div>
  );
}
