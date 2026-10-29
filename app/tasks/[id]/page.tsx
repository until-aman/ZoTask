import { notFound } from "next/navigation";
import Link from "next/link";
import { boot } from "@/lib/boot";
import { all, one } from "@/lib/db";
import { itemsFor, latestSubmission } from "@/lib/engine";
import { rows, eventsFor, STATUS_LABEL, STATUS_PILL } from "@/lib/queries";
import { fmtDate } from "@/lib/time";
import TaskForm from "@/components/TaskForm";
import FlagAnswerForm from "@/components/FlagAnswerForm";
import Timeline from "@/components/Timeline";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await boot();
  const id = Number((await params).id);
  const [r] = await rows("i.id=?", id);
  if (!r) notFound();
  const items = await itemsFor(r.template_id);
  const sub = await latestSubmission(id);
  const prev = sub ? await all<{ item_id: number; checked: number; value: string | null; note: string | null; photos: string }>("SELECT * FROM answers WHERE submission_id=?", sub.id) : [];
  const lastReview = await one<{ id: number; decision: string; kind: string }>("SELECT id, decision, kind FROM reviews WHERE instance_id=? ORDER BY decided_at DESC LIMIT 1", id);
  const flags = lastReview ? await all<{ id: number; item_id: number; reason: string; comment: string | null; answer: string | null }>("SELECT * FROM review_flags WHERE review_id=?", lastReview.id) : [];
  const prop = (await one<{ lat: number; lng: number }>("SELECT lat, lng FROM properties WHERE id=?", r.property_id))!;
  const tpl = (await one<{ geofence: number }>("SELECT geofence FROM templates WHERE id=?", r.template_id))!;
  const canSubmit = ["current", "notsub", "changes"].includes(r.status) && (r.assignee_id === u.id || r.cbm_id === u.id);
  const canAnswer = r.status === "auditflag" && (r.cbm_id === u.id || u.access_role === "admin");

  return (
    <div className="page narrow">
      <Link href="/tasks" className="small">‹ My Tasks</Link>
      <div className="row2">
        <div>
          <h1>{r.task}</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>{r.property} · {r.cluster}, {r.city} · {fmtDate(r.task_date)} · {r.window_start}–{r.window_end}</p>
        </div>
        <span className="spacer" />
        <span className={`pill ${STATUS_PILL[r.status]}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      {r.status === "upcoming" && <div className="card">This task opens at {r.window_start}. You can fill it in once the window opens.</div>}
      {canSubmit && (
        <TaskForm instanceId={id} items={items} status={r.status} attempt={r.attempt} attemptsAllowed={r.attempts_allowed}
          prev={r.status === "changes" ? prev : []} flags={r.status === "changes" ? flags : []}
          property={{ lat: prop.lat, lng: prop.lng, geofence: !!tpl.geofence }} />
      )}
      {canAnswer && <FlagAnswerForm instanceId={id} items={items} flags={flags} />}
      {!canSubmit && !canAnswer && sub && (
        <div className="card grid">
          <h2>Submitted answers · attempt {sub.attempt}</h2>
          {items.map((it) => {
            const a = prev.find((p) => p.item_id === it.id);
            return <div key={it.id} className="small"><b>{it.label}</b>: {a ? (it.kind === "check" ? (a.checked ? "Done" : "Not done") : a.value || "Not recorded") : "Not recorded"}{a && JSON.parse(a.photos).length ? ` · ${JSON.parse(a.photos).length} photo(s)` : ""}</div>;
          })}
        </div>
      )}
      <div className="card">
        <h2>History</h2>
        <Timeline events={await eventsFor(id)} />
      </div>
    </div>
  );
}
