"use client";
// Side drawers: a task list behind any figure, and one task's full record with actions. The dashboard stays put underneath.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { T } from "@/lib/command";
import type { Detail } from "@/lib/detail";
import { getTaskDetail, remindTasks, acknowledgeIssues, escalateIssue } from "@/app/actions";
import { STATUS_LABEL, STATUS_PILL } from "@/lib/statuses";
import ReviewForm from "@/components/ReviewForm";
import Timeline from "@/components/Timeline";
import Photo from "@/components/Photo";
import { Drill, dur } from "./parts";

const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const lateBy = (t: T, now: number) =>
  t.sub ? (t.sub > t.due ? `Late ${dur(t.sub - t.due)}` : "On time") : t.status === "missed" ? `Missed (${dur(t.lateUntil - t.due)} grace)` : t.due < now ? `Open, ${dur(now - t.due)} past` : "Not due yet";

export function DrillDrawer({ drill, tasks, now, close, openTask }: { drill: Drill; tasks: Record<number, T>; now: number; close: () => void; openTask: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"due" | "property" | "status">("due");
  const list = useMemo(() => {
    const l = drill.ids.map((id) => tasks[id]).filter(Boolean)
      .filter((t) => !q || `${t.task} ${t.property} ${t.assignee} ${t.city} ${t.cluster}`.toLowerCase().includes(q.toLowerCase()));
    return l.sort((a, b) => (sort === "due" ? b.due - a.due : sort === "property" ? a.property.localeCompare(b.property) : a.status.localeCompare(b.status)));
  }, [drill, tasks, q, sort]);
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer wide" role="dialog" aria-label={drill.title}>
        <div className="dh">
          <div><h2>{drill.title}</h2><p>{drill.ids.length} {drill.ids.length === 1 ? "task" : "tasks"}{drill.note ? ` · ${drill.note}` : ""}</p></div>
          <button type="button" className="x" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="row2" style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)" }}>
          <input type="search" className="search" placeholder="Search task, property or person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort"><option value="due">Newest deadline</option><option value="property">Property</option><option value="status">Status</option></select>
        </div>
        <div className="db" style={{ padding: 0, gap: 0 }}>
          {!list.length && <div className="empty"><b>No tasks match</b>Try a different search.</div>}
          {list.map((t) => (
            <button key={t.id} type="button" className="drow" onClick={() => openTask(t.id)}>
              <div style={{ minWidth: 0 }}>
                <div className="tname" style={{ fontSize: 13.5 }}>{t.task}{t.crit && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</div>
                <div className="tsub">{t.property} · {t.cluster}, {t.city}</div>
                <div className="tsub">{t.assignee ?? "Unassigned"} · due {when(t.due)} · <span className={t.sub && t.sub <= t.due ? "" : "warn"}>{lateBy(t, now)}</span></div>
              </div>
              <span className={`pill ${STATUS_PILL[t.status]}`}>{STATUS_LABEL[t.status]}</span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

export function TaskDrawer({ id, now, back, close, issue, canEscalate, onDone }: {
  id: number; now: number; back?: () => void; close: () => void; canEscalate: boolean; onDone: (msg: string) => void;
  issue?: { type: string; owner: string; ownerRole: string; ack: { by: string; at: number } | null; esc: { detail: string } | null };
}) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null | undefined>(undefined);
  const [esc, setEsc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setD(undefined);
    getTaskDetail(id).then((x) => { if (live) setD(x); }).catch(() => { if (live) setD(null); });
    return () => { live = false; };
  }, [id, now]);
  const act = async (p: Promise<{ ok: boolean; msg?: string; error?: string }>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    onDone(r.ok ? r.msg ?? "Done" : r.error ?? "Something went wrong");
    if (r.ok) router.refresh();
  };
  const r = d?.r;
  const latest = d?.subs[d.subs.length - 1];
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer wide" role="dialog" aria-label="Task details">
        <div className="dh">
          {back && <button type="button" className="x" style={{ marginLeft: 0 }} onClick={back} aria-label="Back to list">‹</button>}
          <div style={{ minWidth: 0 }}>
            <h2>{r ? r.task : "Loading…"}</h2>
            {r && <p>{r.property} · {r.cluster}, {r.city} · {new Date(r.task_date + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>}
          </div>
          <button type="button" className="x" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="db">
          {d === undefined && <p className="muted">Loading task…</p>}
          {d === null && <div className="err">Couldn&apos;t load this task.</div>}
          {r && d && <>
            <div className="row2">
              <span className={`pill ${STATUS_PILL[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              {r.criticality === "high" && <span className="pill r">Critical task</span>}
              <span className="small muted">Attempt {Math.max(1, r.attempt)} of {r.attempts_allowed}</span>
            </div>
            {issue && <div className={`nextbox ${issue.ownerRole === "Reviewer" ? "" : "r"}`}>
              <h4>{issue.type}</h4>
              <p>Needs: {issue.owner} ({issue.ownerRole})</p>
              {(issue.ack || issue.esc) && <p className="small muted" style={{ fontWeight: 600 }}>{issue.esc ? issue.esc.detail : `Acknowledged by ${issue.ack!.by}`}</p>}
            </div>}
            <dl className="kv">
              <dt>Ground team</dt><dd>{r.assignee ?? "Unassigned"} · {r.op_role}</dd>
              <dt>CBM</dt><dd>{r.cbm ?? "—"}</dd>
              <dt>Deadline</dt><dd>{when(r.window_end_at)}{r.status === "notsub" ? <> · can still submit until {when(r.late_until_at)}</> : null}</dd>
              <dt>Submitted</dt><dd>{r.first_submitted_at ? <>{when(r.first_submitted_at)} {r.first_submitted_at > r.window_end_at ? <span className="pill a">Late {dur(r.first_submitted_at - r.window_end_at)}</span> : <span className="pill g">On time</span>}</> : "Not yet"}</dd>
              <dt>Reviewer</dt><dd>{r.reviewer ?? <span className="pill a">No reviewer assigned</span>} · SLA {r.review_sla_h}h</dd>
              {r.auditor && <><dt>Auditor</dt><dd>{r.auditor} · SLA {r.audit_sla_h}h</dd></>}
            </dl>

            {d.reviews.length > 0 && <div className="grid" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>Reviews</h3>
              {d.reviews.map((x) => (
                <div key={x.id} className="revbox">
                  <div className="row2"><b>{x.kind === "audit" ? "Audit" : "Review"} · {x.decision === "pass" ? "Approved" : x.decision === "fail" ? "Audit failed" : "Sent back"}</b>
                    <span className={`pill ${x.decision === "pass" ? "g" : "r"}`}>{x.reviewer}</span><span className="spacer" />
                    <span className="small muted">{when(x.decided_at)}{x.due_at && x.decided_at > x.due_at ? <span className="warn"> · {dur(x.decided_at - x.due_at)} past SLA</span> : null}</span></div>
                  {x.flags.map((f) => <div key={f.id} className="small"><span className="pill a">{f.reason}</span> {f.item}{f.comment ? ` · “${f.comment}”` : ""}{f.answer ? <span className="muted"> · Answer: {f.answer}</span> : null}</div>)}
                  {x.comment && <div className="small muted">“{x.comment}”</div>}
                </div>
              ))}
            </div>}

            {d.form && ["review", "audit"].includes(d.mode) ? (
              <ReviewForm instanceId={id} mode={d.mode} items={d.items} latest={d.form.latest} previous={d.form.previous}
                prevFlags={d.form.prevFlags} auditFlags={d.form.auditFlags} missing={d.form.missing} />
            ) : latest ? (
              <div className="grid" style={{ gap: 8 }}>
                <h3 style={{ margin: 0 }}>Latest submission · attempt {latest.attempt}</h3>
                <p className="small muted" style={{ margin: 0 }}>By {latest.by_name} · {when(latest.submitted_at)} · {latest.location_ok === null ? "location not checked" : latest.location_ok ? "at the property" : <span className="warn">{latest.distance_m} m away</span>}</p>
                {d.items.map((it) => {
                  const a = latest.answers[it.id];
                  return (
                    <div key={it.id} className="ansrow">
                      <span>{it.label}</span>
                      <span>{!a ? <span className="warn">Not recorded</span> : it.kind === "check" ? (a.checked ? "Done" : <span className="warn">Not done</span>) : a.value ?? <span className="warn">Not recorded</span>}
                        {a?.note && <small className="muted"> · {a.note}</small>}</span>
                      {a?.photos.length ? <div className="photos" style={{ gridColumn: "1 / -1" }}>{a.photos.map((p, i) => <Photo key={i} name={p} />)}</div> : null}
                    </div>
                  );
                })}
              </div>
            ) : <p className="muted">Nothing submitted yet.</p>}

            <div>
              <h3>History</h3>
              <Timeline events={d.events} />
            </div>
          </>}
        </div>
        {r && <div className="df">
          {["notsub", "changes", "review", "resub", "audit", "auditflag", "flagans", "current"].includes(r.status) &&
            <button type="button" className="btn sm" disabled={busy} onClick={() => act(remindTasks([id]))}>Send reminder</button>}
          {issue && !issue.ack && <button type="button" className="btn sm" disabled={busy} onClick={() => act(acknowledgeIssues([id]))}>Acknowledge</button>}
          {issue && canEscalate && !issue.esc && (esc === null
            ? <button type="button" className="btn sm danger" onClick={() => setEsc("")}>Escalate</button>
            : <span className="row2" style={{ flex: "1 1 100%" }}>
                <input type="text" placeholder="Note for the escalation (optional)" value={esc} onChange={(e) => setEsc(e.target.value)} style={{ flex: 1 }} aria-label="Escalation note" />
                <button type="button" className="btn sm danger" disabled={busy} onClick={() => act(escalateIssue(id, esc))}>Escalate now</button>
                <button type="button" className="link small" onClick={() => setEsc(null)}>Cancel</button>
              </span>)}
          <span className="spacer" />
          <Link className="btn sm outline" href={`/review/${id}`}>Open full page</Link>
        </div>}
      </aside>
    </>
  );
}
