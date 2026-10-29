// Task lifecycle: instance generation, time-based sweeps, submit, review, audit.
import { all, one, run, tx } from "./db";
import { DAY, HOUR, addDays, atTime, isoDate, weekday } from "./time";

export const REASONS = ["Photo missing", "Photo unclear", "Wrong location", "Count mismatch", "Item not done", "Other"];
export const GEOFENCE_M = 200;

export type Template = {
  id: number; name: string; category: string; op_role: string; trigger: string; event_name: string | null;
  frequency: string; weekday: number | null; window_start: string; window_end: string;
  review_sla_h: number; audit_sla_h: number; attempts_allowed: number; late_window_days: number;
  criticality: string; audit_rate: number; geofence: number; reviewer_id: number | null; auditor_id: number | null; active: number;
};
export type Item = { id: number; template_id: number; pos: number; label: string; kind: string; photo_required: number; note_required: number };
export type Instance = {
  id: number; template_id: number; property_id: number; task_date: string; window_start_at: number; window_end_at: number;
  late_until_at: number; assignee_id: number | null; reviewer_id: number | null; auditor_id: number | null; status: string;
  attempt: number; first_submitted_at: number | null; last_submitted_at: number | null; status_since: number;
  first_decision: string | null; closed_at: number | null; source: string;
};
export type AnswerInput = { itemId: number; checked: boolean; value?: string; note?: string; photos?: string[]; reply?: string };
export type FlagInput = { itemId: number; reason: string; comment?: string };

export function logEvent(instanceId: number, at: number, actorId: number | null, type: string, detail = "") {
  run("INSERT INTO events (instance_id, at, actor_id, type, detail) VALUES (?,?,?,?,?)", instanceId, at, actorId, type, detail);
}
function setStatus(id: number, status: string, at: number, extra = "", ...params: unknown[]) {
  run(`UPDATE instances SET status=?, status_since=?${extra} WHERE id=?`, status, at, ...params, id);
}
function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 16;
  return (x % 1000) / 1000;
}

function pickAssignee(t: Template, propertyId: number): number | null {
  if (t.op_role === "CBM") return one<{ cbm_id: number }>("SELECT cbm_id FROM properties WHERE id=?", propertyId)?.cbm_id ?? null;
  const u = one<{ id: number }>(
    `SELECT u.id FROM users u JOIN user_properties up ON up.user_id=u.id
     WHERE up.property_id=? AND u.op_role=? ORDER BY u.id LIMIT 1`, propertyId, t.op_role);
  return u?.id ?? null;
}

function appliesOn(t: Template, date: string) {
  if (t.trigger !== "scheduled") return false;
  if (t.frequency === "daily") return true;
  if (t.frequency === "weekly") return weekday(date) === (t.weekday ?? 1);
  if (t.frequency === "monthly") return date.endsWith("-01");
  return false;
}

export function createInstance(t: Template, propertyId: number, date: string, source: string, now: number): number | null {
  let start = atTime(date, t.window_start);
  let end = atTime(date, t.window_end);
  if (source !== "schedule") {
    // Event and on-demand tasks open now and run for the template's window length.
    const len = Math.max(HOUR, end - start);
    start = now;
    end = now + len;
  }
  const lateUntil = t.late_window_days === 0 ? atTime(isoDate(end), "23:59") : end + t.late_window_days * DAY;
  const res = run(
    `INSERT OR IGNORE INTO instances (template_id, property_id, task_date, window_start_at, window_end_at, late_until_at,
      assignee_id, reviewer_id, auditor_id, status, status_since, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    t.id, propertyId, date, start, end, lateUntil, pickAssignee(t, propertyId), t.reviewer_id, t.auditor_id,
    now >= start ? "current" : "upcoming", Math.min(now, start), source);
  if (!res.changes) return null;
  const id = Number(res.lastInsertRowid);
  logEvent(id, Math.min(now, start), null, "created", source === "schedule" ? "Scheduled" : source);
  return id;
}

export function generateInstances(from: string, to: string, now: number) {
  const templates = all<Template>("SELECT * FROM templates WHERE active=1 AND trigger='scheduled'");
  tx(() => {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      for (const t of templates) {
        if (!appliesOn(t, d)) continue;
        const props = all<{ property_id: number }>("SELECT property_id FROM template_properties WHERE template_id=?", t.id);
        for (const p of props) createInstance(t, p.property_id, d, "schedule", now);
      }
    }
  });
}

export function triggerEvent(templateId: number, propertyId: number, actorId: number, now: number) {
  const t = one<Template>("SELECT * FROM templates WHERE id=?", templateId)!;
  const id = createInstance(t, propertyId, isoDate(now), `${t.trigger}:${now}`, now);
  if (id) logEvent(id, now, actorId, "triggered", t.event_name || "On demand");
  return id;
}

/** Moves instances along time-based transitions. Safe to call on every request. */
export function sweep(now = Date.now()) {
  generateInstances(isoDate(now), addDays(isoDate(now), 1), now);
  tx(() => {
    for (const i of all<Instance>("SELECT * FROM instances WHERE status='upcoming' AND window_start_at<=?", now)) {
      setStatus(i.id, "current", i.window_start_at);
    }
    for (const i of all<Instance>("SELECT * FROM instances WHERE status='current' AND window_end_at<=?", now)) {
      setStatus(i.id, "notsub", i.window_end_at);
      logEvent(i.id, i.window_end_at, null, "window_closed", "Now in late window");
    }
    for (const i of all<Instance>("SELECT * FROM instances WHERE status='notsub' AND late_until_at<=?", now)) {
      setStatus(i.id, "missed", i.late_until_at, ", closed_at=?", i.late_until_at);
      logEvent(i.id, i.late_until_at, null, "missed", "Late window ended unsubmitted");
    }
  });
}

export function itemsFor(templateId: number) {
  return all<Item>("SELECT * FROM template_items WHERE template_id=? AND pos<1000 ORDER BY pos", templateId);
}

/** Items missing mandatory evidence on a submission ("Not recorded"). */
export function missingEvidence(submissionId: number, templateId: number): Item[] {
  const ans = all<{ item_id: number; checked: number; value: string | null; note: string | null; photos: string }>(
    "SELECT item_id, checked, value, note, photos FROM answers WHERE submission_id=?", submissionId);
  const byItem = new Map(ans.map((a) => [a.item_id, a]));
  return itemsFor(templateId).filter((it) => {
    const a = byItem.get(it.id);
    if (!a) return true;
    if (it.kind === "check" && !a.checked) return true;
    if (it.kind !== "check" && !a.value) return true;
    if (it.photo_required && JSON.parse(a.photos).length === 0) return true;
    if (it.note_required && !a.note) return true;
    return false;
  });
}

export function submit(instanceId: number, userId: number, answers: AnswerInput[], loc: { ok: boolean | null; distance: number | null }, at: number) {
  return tx(() => {
    const i = one<Instance>("SELECT * FROM instances WHERE id=?", instanceId)!;
    const t = one<Template>("SELECT * FROM templates WHERE id=?", i.template_id)!;
    if (!["current", "notsub", "changes"].includes(i.status)) throw new Error("This task can't be submitted right now.");
    const resub = i.status === "changes";
    const attempt = i.attempt + 1;
    const s = run("INSERT INTO submissions (instance_id, attempt, submitted_by, submitted_at, location_ok, distance_m) VALUES (?,?,?,?,?,?)",
      instanceId, attempt, userId, at, loc.ok === null ? null : loc.ok ? 1 : 0, loc.distance);
    const sid = Number(s.lastInsertRowid);
    for (const a of answers) {
      run("INSERT INTO answers (submission_id, item_id, checked, value, note, photos, reply) VALUES (?,?,?,?,?,?,?)",
        sid, a.itemId, a.checked ? 1 : 0, a.value ?? null, a.note ?? null, JSON.stringify((a.photos ?? []).slice(0, 10)), a.reply ?? null);
    }
    if (resub) {
      setStatus(instanceId, "resub", at, ", attempt=?, last_submitted_at=?", attempt, at);
      logEvent(instanceId, at, userId, "resubmitted", `Attempt ${attempt} of ${t.attempts_allowed}`);
    } else {
      const late = at > i.window_end_at;
      setStatus(instanceId, "review", at, ", attempt=?, first_submitted_at=?, last_submitted_at=?", attempt, at, at);
      logEvent(instanceId, at, userId, "submitted", late ? "Submitted late" : "Submitted on time");
    }
    if (t.geofence && loc.ok === false) logEvent(instanceId, at, userId, "location_warning", `Submitted ${loc.distance ?? "?"} m from property`);
    return sid;
  });
}

export function latestSubmission(instanceId: number) {
  return one<{ id: number; attempt: number; submitted_at: number; submitted_by: number; location_ok: number | null; distance_m: number | null }>(
    "SELECT * FROM submissions WHERE instance_id=? ORDER BY attempt DESC LIMIT 1", instanceId);
}

function pickAuditor(i: Instance, reviewerId: number, at: number) {
  const sub = latestSubmission(i.id);
  const bad = new Set([reviewerId, sub?.submitted_by, i.assignee_id]);
  if (i.auditor_id && !bad.has(i.auditor_id)) return i.auditor_id;
  const auditors = all<{ id: number }>("SELECT id FROM users WHERE access_role='auditor' ORDER BY id");
  return auditors.find((a) => !bad.has(a.id))?.id ?? auditors[0]?.id ?? null;
}

export function reviewDecision(instanceId: number, reviewerId: number, decision: "pass" | "changes", flags: FlagInput[], comment: string, at: number, openedAt?: number) {
  return tx(() => {
    const i = one<Instance>("SELECT * FROM instances WHERE id=?", instanceId)!;
    const t = one<Template>("SELECT * FROM templates WHERE id=?", i.template_id)!;
    if (!["review", "resub"].includes(i.status)) throw new Error("This task is not waiting for review.");
    const sub = latestSubmission(instanceId)!;
    if (sub.submitted_by === reviewerId) throw new Error("You submitted this task, so someone else must review it.");
    if (decision === "pass") {
      const missing = missingEvidence(sub.id, t.id);
      if (missing.length) throw new Error(`Can't pass: "${missing[0].label}" has no evidence recorded. Flag it instead.`);
    } else if (!flags.length) throw new Error("Flag at least one item, with a reason, to request changes.");
    const r = run("INSERT INTO reviews (instance_id, submission_id, reviewer_id, kind, decision, opened_at, decided_at, due_at, comment) VALUES (?,?,?,?,?,?,?,?,?)",
      instanceId, sub.id, reviewerId, "review", decision, openedAt ?? null, at, (i.last_submitted_at ?? at) + t.review_sla_h * HOUR, comment || null);
    const rid = Number(r.lastInsertRowid);
    for (const f of flags) run("INSERT INTO review_flags (review_id, item_id, reason, comment) VALUES (?,?,?,?)", rid, f.itemId, f.reason, f.comment ?? null);
    if (!i.first_decision) run("UPDATE instances SET first_decision=? WHERE id=?", decision, instanceId);
    run("UPDATE instances SET reviewer_id=? WHERE id=?", reviewerId, instanceId);
    if (decision === "changes") {
      const exhausted = i.attempt >= t.attempts_allowed;
      setStatus(instanceId, exhausted ? "notrect" : "changes", at, exhausted ? ", closed_at=?" : "", ...(exhausted ? [at] : []));
      logEvent(instanceId, at, reviewerId, "changes_requested", flags.map((f) => f.reason).join(", ") + (exhausted ? " · attempts used up, not rectified" : ""));
    } else {
      const sampled = hash(instanceId) < t.audit_rate;
      if (sampled) {
        const aud = pickAuditor(i, reviewerId, at);
        setStatus(instanceId, "audit", at, ", auditor_id=?", aud);
        logEvent(instanceId, at, reviewerId, "passed", "Selected for audit");
      } else {
        setStatus(instanceId, "done", at, ", closed_at=?", at);
        logEvent(instanceId, at, reviewerId, "passed", "Verified");
      }
    }
  });
}

export function auditDecision(instanceId: number, auditorId: number, decision: "pass" | "fail", flags: FlagInput[], comment: string, at: number) {
  return tx(() => {
    const i = one<Instance>("SELECT * FROM instances WHERE id=?", instanceId)!;
    const t = one<Template>("SELECT * FROM templates WHERE id=?", i.template_id)!;
    if (i.status !== "audit") throw new Error("This task is not waiting for audit.");
    const lastReview = one<{ reviewer_id: number }>("SELECT reviewer_id FROM reviews WHERE instance_id=? AND kind='review' ORDER BY decided_at DESC LIMIT 1", instanceId);
    if (lastReview?.reviewer_id === auditorId) throw new Error("You reviewed this task, so you can't audit it.");
    if (decision === "fail" && !flags.length) throw new Error("Flag at least one item to fail an audit.");
    const sub = latestSubmission(instanceId)!;
    const r = run("INSERT INTO reviews (instance_id, submission_id, reviewer_id, kind, decision, decided_at, due_at, comment) VALUES (?,?,?,?,?,?,?,?)",
      instanceId, sub.id, auditorId, "audit", decision, at, i.status_since + t.audit_sla_h * HOUR, comment || null);
    const rid = Number(r.lastInsertRowid);
    for (const f of flags) run("INSERT INTO review_flags (review_id, item_id, reason, comment) VALUES (?,?,?,?)", rid, f.itemId, f.reason, f.comment ?? null);
    if (decision === "pass") {
      setStatus(instanceId, "done", at, ", closed_at=?", at);
      logEvent(instanceId, at, auditorId, "audit_passed", "Closed");
    } else {
      setStatus(instanceId, "auditflag", at);
      logEvent(instanceId, at, auditorId, "audit_failed", flags.map((f) => f.reason).join(", ") + " · CBM to answer");
    }
  });
}

export function answerAuditFlags(instanceId: number, userId: number, answers: Record<number, string>, at: number) {
  tx(() => {
    const i = one<Instance>("SELECT * FROM instances WHERE id=?", instanceId)!;
    if (i.status !== "auditflag") throw new Error("No open audit flags on this task.");
    for (const [fid, text] of Object.entries(answers)) run("UPDATE review_flags SET answer=?, answered_at=? WHERE id=?", text, at, Number(fid));
    setStatus(instanceId, "flagans", at);
    logEvent(instanceId, at, userId, "flags_answered", `${Object.keys(answers).length} flag(s) answered`);
  });
}

export function closeFlagAnswers(instanceId: number, auditorId: number, accept: boolean, at: number) {
  tx(() => {
    const i = one<Instance>("SELECT * FROM instances WHERE id=?", instanceId)!;
    if (i.status !== "flagans") throw new Error("Nothing to close.");
    if (accept) {
      setStatus(instanceId, "done", at, ", closed_at=?", at);
      logEvent(instanceId, at, auditorId, "flags_closed", "Answers accepted, task closed");
    } else {
      setStatus(instanceId, "auditflag", at);
      logEvent(instanceId, at, auditorId, "flags_reopened", "Answers not accepted");
    }
  });
}

export function reopen(instanceId: number, actorId: number, at: number) {
  const i = one<Instance>("SELECT * FROM instances WHERE id=?", instanceId)!;
  if (i.status !== "done") throw new Error("Only verified tasks can be reopened.");
  setStatus(instanceId, "review", at, ", closed_at=NULL");
  logEvent(instanceId, at, actorId, "reopened", "Back to review");
}

export function waive(instanceId: number, actorId: number, reason: string, at: number) {
  const i = one<Instance>("SELECT * FROM instances WHERE id=?", instanceId)!;
  if (!["upcoming", "current", "notsub"].includes(i.status)) throw new Error("Only open, unsubmitted tasks can be waived.");
  setStatus(instanceId, "waived", at, ", closed_at=?", at);
  logEvent(instanceId, at, actorId, "waived", reason);
}

export function reassignReviewer(instanceId: number, reviewerId: number, actorId: number, at: number) {
  run("UPDATE instances SET reviewer_id=? WHERE id=?", reviewerId, instanceId);
  const u = one<{ name: string }>("SELECT name FROM users WHERE id=?", reviewerId);
  logEvent(instanceId, at, actorId, "reassigned", `Reviewer: ${u?.name}`);
}

/** Who has to act next on an instance, as a user id (null when closed). */
export function nextActor(i: Pick<Instance, "status" | "assignee_id" | "reviewer_id" | "auditor_id">, cbmId: number | null) {
  switch (i.status) {
    case "upcoming": case "current": case "notsub": case "changes": return i.assignee_id;
    case "review": case "resub": return i.reviewer_id;
    case "audit": case "flagans": return i.auditor_id;
    case "auditflag": return cbmId;
    default: return null;
  }
}

export function remind(instanceIds: number[], actorId: number, at: number) {
  const people = new Set<number>();
  let skipped = 0;
  tx(() => {
    for (const id of instanceIds) {
      // Don't nag: skip a task that already got a reminder in the last 4 hours.
      if (one("SELECT 1 FROM events WHERE instance_id=? AND type='reminder' AND at>?", id, at - 4 * HOUR)) { skipped++; continue; }
      const i = one<Instance & { cbm_id: number | null }>(
        "SELECT i.*, p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", id);
      if (!i) continue;
      const who = nextActor(i, i.cbm_id);
      if (!who) continue;
      people.add(who);
      const u = one<{ name: string }>("SELECT name FROM users WHERE id=?", who);
      logEvent(id, at, actorId, "reminder", `Reminder sent to ${u?.name}`);
    }
  });
  return { people: people.size, skipped };
}
