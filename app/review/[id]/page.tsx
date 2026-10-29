import { notFound } from "next/navigation";
import Link from "next/link";
import { boot } from "@/lib/boot";
import { all } from "@/lib/db";
import { itemsFor, missingEvidence } from "@/lib/engine";
import { rows, eventsFor, STATUS_LABEL, STATUS_PILL } from "@/lib/queries";
import { fmtDate, fmtDateTime, fmtDur } from "@/lib/time";
import ReviewForm from "@/components/ReviewForm";
import Timeline from "@/components/Timeline";

export default async function ReviewSheet({ params }: { params: Promise<{ id: string }> }) {
  const u = await boot();
  const id = Number((await params).id);
  const [r] = await rows("i.id=?", id);
  if (!r) notFound();
  const items = await itemsFor(r.template_id);
  const subs = await all<{ id: number; attempt: number; submitted_at: number; submitted_by: number; location_ok: number | null; distance_m: number | null; by_name: string }>(
    "SELECT s.*, u.name AS by_name FROM submissions s JOIN users u ON u.id=s.submitted_by WHERE instance_id=? ORDER BY attempt", id);
  const answers = await all<{ submission_id: number; item_id: number; checked: number; value: string | null; note: string | null; photos: string; reply: string | null }>(
    `SELECT a.* FROM answers a JOIN submissions s ON s.id=a.submission_id WHERE s.instance_id=?`, id);
  const reviews = await all<{ id: number; kind: string; decision: string; decided_at: number; reviewer: string; comment: string | null; submission_id: number }>(
    "SELECT r.*, u.name reviewer FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE instance_id=? ORDER BY decided_at", id);
  const flags = await all<{ id: number; review_id: number; item_id: number; reason: string; comment: string | null; answer: string | null }>(
    "SELECT f.* FROM review_flags f JOIN reviews r ON r.id=f.review_id WHERE r.instance_id=?", id);
  const latest = subs[subs.length - 1];
  const missing = latest ? (await missingEvidence(latest.id, r.template_id)).map((m) => m.id) : [];

  const mode =
    ["review", "resub"].includes(r.status) && ["reviewer", "admin"].includes(u.access_role) ? "review" :
    r.status === "audit" && ["auditor", "admin"].includes(u.access_role) ? "audit" :
    r.status === "flagans" && ["auditor", "admin"].includes(u.access_role) ? "closeflags" :
    r.status === "done" && ["reviewer", "admin"].includes(u.access_role) ? "reopen" :
    ["current", "notsub"].includes(r.status) && ["cbm", "admin"].includes(u.access_role) ? "waive" : "view";

  const pack = (sid?: number) => Object.fromEntries(answers.filter((a) => a.submission_id === sid).map((a) => [a.item_id, { ...a, photos: JSON.parse(a.photos) as string[] }]));
  const lastAudit = [...reviews].reverse().find((x) => x.kind === "audit");

  return (
    <div className="page narrow">
      <Link href="/queue" className="small">‹ Review Queue</Link>
      <div className="row2">
        <div>
          <h1>{r.task}</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>{r.property} · {r.cluster}, {r.city} · {fmtDate(r.task_date)} · window {r.window_start}–{r.window_end}</p>
        </div>
        <span className="spacer" />
        <span className={`pill ${STATUS_PILL[r.status]}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Assignee</dt><dd>{r.assignee} · {r.op_role}</dd>
          <dt>CBM</dt><dd>{r.cbm}</dd>
          <dt>Reviewer</dt><dd>{r.reviewer ?? "—"} · review within {r.review_sla_h}h</dd>
          <dt>Auditor</dt><dd>{r.auditor ?? "—"} · audit within {r.audit_sla_h}h</dd>
          {latest && <><dt>Submitted</dt><dd>{fmtDateTime(latest.submitted_at)} by {latest.by_name} · attempt {latest.attempt} of {r.attempts_allowed}
            {latest.submitted_at > r.window_end_at && subs[0].id === latest.id ? <span className="pill a" style={{ marginLeft: 6 }}>Late by {fmtDur(latest.submitted_at - r.window_end_at)}</span> : null}</dd></>}
          {latest && <><dt>Location</dt><dd>{latest.location_ok === null ? <span className="pill a">Not checked</span> : latest.location_ok ? <span className="pill g">At property</span> : <span className="pill r">{latest.distance_m} m away</span>}</dd></>}
        </dl>
      </div>
      {!latest && <div className="card muted">Nothing has been submitted yet.</div>}
      {latest && (
        <ReviewForm instanceId={id} mode={mode} items={items} latest={pack(latest.id)} previous={subs.length > 1 ? pack(subs[subs.length - 2].id) : null}
          prevFlags={flags.filter((f) => reviews.find((x) => x.id === f.review_id)?.submission_id === subs[subs.length - 2]?.id)}
          auditFlags={lastAudit ? flags.filter((f) => f.review_id === lastAudit.id) : []} missing={missing} />
      )}
      {mode === "waive" && <ReviewForm instanceId={id} mode="waive" items={[]} latest={{}} previous={null} prevFlags={[]} auditFlags={[]} missing={[]} />}
      <div className="card">
        <h2>History</h2>
        <Timeline events={await eventsFor(id)} />
      </div>
    </div>
  );
}
