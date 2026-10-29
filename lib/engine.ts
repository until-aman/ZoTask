// Task lifecycle: instance generation, time-based sweeps, submit, review, audit.
import { all, batch, one, run, tx } from "./db";
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

export async function logEvent(instanceId: number, at: number, actorId: number | null, type: string, detail = "") {
  await run("INSERT INTO events (instance_id, at, actor_id, type, detail) VALUES (?,?,?,?,?)", instanceId, at, actorId, type, detail);
}
async function setStatus(id: number, status: string, at: number, extra = "", ...params: unknown[]) {
  await run(`UPDATE instances SET status=?, status_since=?${extra} WHERE id=?`, status, at, ...params, id);
}
function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 16;
  return (x % 1000) / 1000;
}

async function pickAssignee(t: Template, propertyId: number): Promise<number | null> {
  if (t.op_role === "CBM") return (await one<{ cbm_id: number }>("SELECT cbm_id FROM properties WHERE id=?", propertyId))?.cbm_id ?? null;
  const u = await one<{ id: number }>(
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

export async function createInstance(t: Template, propertyId: number, date: string, source: string, now: number, assignee?: number | null): Promise<number | null> {
  let start = atTime(date, t.window_start);
  let end = atTime(date, t.window_end);
  if (source !== "schedule") {
    // Event and on-demand tasks open now and run for the template's window length.
    const len = Math.max(HOUR, end - start);
    start = now;
    end = now + len;
  }
  const lateUntil = t.late_window_days === 0 ? atTime(isoDate(end), "23:59") : end + t.late_window_days * DAY;
  const res = await run(
    `INSERT OR IGNORE INTO instances (template_id, property_id, task_date, window_start_at, window_end_at, late_until_at,
      assignee_id, reviewer_id, auditor_id, status, status_since, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    t.id, propertyId, date, start, end, lateUntil, assignee !== undefined ? assignee : await pickAssignee(t, propertyId), t.reviewer_id, t.auditor_id,
    now >= start ? "current" : "upcoming", Math.min(now, start), source);
  if (!res.changes) return null;
  const id = Number(res.lastInsertRowid);
  await logEvent(id, Math.min(now, start), null, "created", source === "schedule" ? "Scheduled" : source);
  return id;
}

export async function generateInstances(from: string, to: string, now: number) {
  const templates = await all<Template>("SELECT * FROM templates WHERE active=1 AND trigger='scheduled'");
  const links = await all<{ template_id: number; property_id: number }>("SELECT template_id, property_id FROM template_properties");
  // Only the instances that don't exist yet; on most requests that is none, so this costs three reads.
  const have = new Set((await all<{ k: string }>(
    "SELECT template_id || ':' || property_id || ':' || task_date k FROM instances WHERE source='schedule' AND task_date BETWEEN ? AND ?", from, to)).map((x) => x.k));
  const todo: [Template, number, string][] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const t of templates) {
      if (!appliesOn(t, d)) continue;
      for (const l of links) if (l.template_id === t.id && !have.has(`${t.id}:${l.property_id}:${d}`)) todo.push([t, l.property_id, d]);
    }
  }
  if (!todo.length) return;
  // Same choice as pickAssignee, read once for the whole run.
  const cbm = new Map((await all<{ id: number; cbm_id: number | null }>("SELECT id, cbm_id FROM properties")).map((p) => [p.id, p.cbm_id]));
  const staff = await all<{ id: number; property_id: number; op_role: string }>(
    "SELECT u.id, up.property_id, u.op_role FROM users u JOIN user_properties up ON up.user_id=u.id ORDER BY u.id");
  const who = (t: Template, p: number) => t.op_role === "CBM" ? cbm.get(p) ?? null : staff.find((s) => s.property_id === p && s.op_role === t.op_role)?.id ?? null;
  await tx(async () => { for (const [t, p, d] of todo) await createInstance(t, p, d, "schedule", now, who(t, p)); });
}

export async function triggerEvent(templateId: number, propertyId: number, actorId: number, now: number) {
  const t = (await one<Template>("SELECT * FROM templates WHERE id=?", templateId))!;
  const id = await createInstance(t, propertyId, isoDate(now), `${t.trigger}:${now}`, now);
  if (id) await logEvent(id, now, actorId, "triggered", t.event_name || "On demand");
  return id;
}

/** Moves instances along time-based transitions. Safe to call on every request: when nothing is due it is one read. */
export async function sweep(now = Date.now()) {
  await generateInstances(isoDate(now), addDays(isoDate(now), 1), now);
  const due = await one<{ n: number }>(`SELECT count(*) n FROM instances WHERE (status='upcoming' AND window_start_at<=?)
    OR (status='current' AND window_end_at<=?) OR (status='notsub' AND late_until_at<=?)`, now, now, now);
  if (!due?.n) return;
  await batch([
    ["UPDATE instances SET status='current', status_since=window_start_at WHERE status='upcoming' AND window_start_at<=?", now],
    [`INSERT INTO events (instance_id, at, actor_id, type, detail)
      SELECT id, window_end_at, NULL, 'window_closed', 'Now in late window' FROM instances WHERE status='current' AND window_end_at<=? ORDER BY id`, now],
    ["UPDATE instances SET status='notsub', status_since=window_end_at WHERE status='current' AND window_end_at<=?", now],
    [`INSERT INTO events (instance_id, at, actor_id, type, detail)
      SELECT id, late_until_at, NULL, 'missed', 'Late window ended unsubmitted' FROM instances WHERE status='notsub' AND late_until_at<=? ORDER BY id`, now],
    ["UPDATE instances SET status='missed', status_since=late_until_at, closed_at=late_until_at WHERE status='notsub' AND late_until_at<=?", now],
  ]);
}

export async function itemsFor(templateId: number) {
  return await all<Item>("SELECT * FROM template_items WHERE template_id=? AND pos<1000 ORDER BY pos", templateId);
}

/** Items missing mandatory evidence on a submission ("Not recorded"). */
export async function missingEvidence(submissionId: number, templateId: number): Promise<Item[]> {
  const ans = await all<{ item_id: number; checked: number; value: string | null; note: string | null; photos: string }>(
    "SELECT item_id, checked, value, note, photos FROM answers WHERE submission_id=?", submissionId);
  const byItem = new Map(ans.map((a) => [a.item_id, a]));
  return (await itemsFor(templateId)).filter((it) => {
    const a = byItem.get(it.id);
    if (!a) return true;
    if (it.kind === "check" && !a.checked) return true;
    if (it.kind !== "check" && !a.value) return true;
    if (it.photo_required && JSON.parse(a.photos).length === 0) return true;
    if (it.note_required && !a.note) return true;
    return false;
  });
}

export async function submit(instanceId: number, userId: number, answers: AnswerInput[], loc: { ok: boolean | null; distance: number | null }, at: number) {
  return await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    const t = (await one<Template>("SELECT * FROM templates WHERE id=?", i.template_id))!;
    if (!["current", "notsub", "changes"].includes(i.status)) throw new Error("This task can't be submitted right now.");
    const resub = i.status === "changes";
    const attempt = i.attempt + 1;
    const s = await run("INSERT INTO submissions (instance_id, attempt, submitted_by, submitted_at, location_ok, distance_m) VALUES (?,?,?,?,?,?)",
      instanceId, attempt, userId, at, loc.ok === null ? null : loc.ok ? 1 : 0, loc.distance);
    const sid = Number(s.lastInsertRowid);
    for (const a of answers) {
      await run("INSERT INTO answers (submission_id, item_id, checked, value, note, photos, reply) VALUES (?,?,?,?,?,?,?)",
        sid, a.itemId, a.checked ? 1 : 0, a.value ?? null, a.note ?? null, JSON.stringify((a.photos ?? []).slice(0, 10)), a.reply ?? null);
    }
    if (resub) {
      await setStatus(instanceId, "resub", at, ", attempt=?, last_submitted_at=?", attempt, at);
      await logEvent(instanceId, at, userId, "resubmitted", `Attempt ${attempt} of ${t.attempts_allowed}`);
    } else {
      const late = at > i.window_end_at;
      await setStatus(instanceId, "review", at, ", attempt=?, first_submitted_at=?, last_submitted_at=?", attempt, at, at);
      await logEvent(instanceId, at, userId, "submitted", late ? "Submitted late" : "Submitted on time");
    }
    if (t.geofence && loc.ok === false) await logEvent(instanceId, at, userId, "location_warning", `Submitted ${loc.distance ?? "?"} m from property`);
    return sid;
  });
}

export async function latestSubmission(instanceId: number) {
  return await one<{ id: number; attempt: number; submitted_at: number; submitted_by: number; location_ok: number | null; distance_m: number | null }>(
    "SELECT * FROM submissions WHERE instance_id=? ORDER BY attempt DESC LIMIT 1", instanceId);
}

async function pickAuditor(i: Instance, reviewerId: number, at: number) {
  const sub = await latestSubmission(i.id);
  const bad = new Set([reviewerId, sub?.submitted_by, i.assignee_id]);
  if (i.auditor_id && !bad.has(i.auditor_id)) return i.auditor_id;
  const auditors = await all<{ id: number }>("SELECT id FROM users WHERE access_role='auditor' ORDER BY id");
  return auditors.find((a) => !bad.has(a.id))?.id ?? auditors[0]?.id ?? null;
}

export async function reviewDecision(instanceId: number, reviewerId: number, decision: "pass" | "changes", flags: FlagInput[], comment: string, at: number, openedAt?: number) {
  return await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    const t = (await one<Template>("SELECT * FROM templates WHERE id=?", i.template_id))!;
    if (!["review", "resub"].includes(i.status)) throw new Error("This task is not waiting for review.");
    const sub = (await latestSubmission(instanceId))!;
    if (sub.submitted_by === reviewerId) throw new Error("You submitted this task, so someone else must review it.");
    if (decision === "pass") {
      const missing = await missingEvidence(sub.id, t.id);
      if (missing.length) throw new Error(`Can't pass: "${missing[0].label}" has no evidence recorded. Flag it instead.`);
    } else if (!flags.length) throw new Error("Flag at least one item, with a reason, to request changes.");
    const r = await run("INSERT INTO reviews (instance_id, submission_id, reviewer_id, kind, decision, opened_at, decided_at, due_at, comment) VALUES (?,?,?,?,?,?,?,?,?)",
      instanceId, sub.id, reviewerId, "review", decision, openedAt ?? null, at, (i.last_submitted_at ?? at) + t.review_sla_h * HOUR, comment || null);
    const rid = Number(r.lastInsertRowid);
    for (const f of flags) await run("INSERT INTO review_flags (review_id, item_id, reason, comment) VALUES (?,?,?,?)", rid, f.itemId, f.reason, f.comment ?? null);
    if (!i.first_decision) await run("UPDATE instances SET first_decision=? WHERE id=?", decision, instanceId);
    await run("UPDATE instances SET reviewer_id=? WHERE id=?", reviewerId, instanceId);
    if (decision === "changes") {
      const exhausted = i.attempt >= t.attempts_allowed;
      await setStatus(instanceId, exhausted ? "notrect" : "changes", at, exhausted ? ", closed_at=?" : "", ...(exhausted ? [at] : []));
      await logEvent(instanceId, at, reviewerId, "changes_requested", flags.map((f) => f.reason).join(", ") + (exhausted ? " · attempts used up, not rectified" : ""));
    } else {
      const sampled = hash(instanceId) < t.audit_rate;
      if (sampled) {
        const aud = await pickAuditor(i, reviewerId, at);
        await setStatus(instanceId, "audit", at, ", auditor_id=?", aud);
        await logEvent(instanceId, at, reviewerId, "passed", "Selected for audit");
      } else {
        await setStatus(instanceId, "done", at, ", closed_at=?", at);
        await logEvent(instanceId, at, reviewerId, "passed", "Verified");
      }
    }
  });
}

export async function auditDecision(instanceId: number, auditorId: number, decision: "pass" | "fail", flags: FlagInput[], comment: string, at: number) {
  return await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    const t = (await one<Template>("SELECT * FROM templates WHERE id=?", i.template_id))!;
    if (i.status !== "audit") throw new Error("This task is not waiting for audit.");
    const lastReview = await one<{ reviewer_id: number }>("SELECT reviewer_id FROM reviews WHERE instance_id=? AND kind='review' ORDER BY decided_at DESC LIMIT 1", instanceId);
    if (lastReview?.reviewer_id === auditorId) throw new Error("You reviewed this task, so you can't audit it.");
    if (decision === "fail" && !flags.length) throw new Error("Flag at least one item to fail an audit.");
    const sub = (await latestSubmission(instanceId))!;
    const r = await run("INSERT INTO reviews (instance_id, submission_id, reviewer_id, kind, decision, decided_at, due_at, comment) VALUES (?,?,?,?,?,?,?,?)",
      instanceId, sub.id, auditorId, "audit", decision, at, i.status_since + t.audit_sla_h * HOUR, comment || null);
    const rid = Number(r.lastInsertRowid);
    for (const f of flags) await run("INSERT INTO review_flags (review_id, item_id, reason, comment) VALUES (?,?,?,?)", rid, f.itemId, f.reason, f.comment ?? null);
    if (decision === "pass") {
      await setStatus(instanceId, "done", at, ", closed_at=?", at);
      await logEvent(instanceId, at, auditorId, "audit_passed", "Closed");
    } else {
      await setStatus(instanceId, "auditflag", at);
      await logEvent(instanceId, at, auditorId, "audit_failed", flags.map((f) => f.reason).join(", ") + " · CBM to answer");
    }
  });
}

export async function answerAuditFlags(instanceId: number, userId: number, answers: Record<number, string>, at: number) {
  await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    if (i.status !== "auditflag") throw new Error("No open audit flags on this task.");
    for (const [fid, text] of Object.entries(answers)) await run("UPDATE review_flags SET answer=?, answered_at=? WHERE id=?", text, at, Number(fid));
    await setStatus(instanceId, "flagans", at);
    await logEvent(instanceId, at, userId, "flags_answered", `${Object.keys(answers).length} flag(s) answered`);
  });
}

export async function closeFlagAnswers(instanceId: number, auditorId: number, accept: boolean, at: number) {
  await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    if (i.status !== "flagans") throw new Error("Nothing to close.");
    if (accept) {
      await setStatus(instanceId, "done", at, ", closed_at=?", at);
      await logEvent(instanceId, at, auditorId, "flags_closed", "Answers accepted, task closed");
    } else {
      await setStatus(instanceId, "auditflag", at);
      await logEvent(instanceId, at, auditorId, "flags_reopened", "Answers not accepted");
    }
  });
}

export async function reopen(instanceId: number, actorId: number, at: number) {
  const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
  if (i.status !== "done") throw new Error("Only verified tasks can be reopened.");
  await setStatus(instanceId, "review", at, ", closed_at=NULL");
  await logEvent(instanceId, at, actorId, "reopened", "Back to review");
}

export async function waive(instanceId: number, actorId: number, reason: string, at: number) {
  const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
  if (!["upcoming", "current", "notsub"].includes(i.status)) throw new Error("Only open, unsubmitted tasks can be waived.");
  await setStatus(instanceId, "waived", at, ", closed_at=?", at);
  await logEvent(instanceId, at, actorId, "waived", reason);
}

export async function reassignReviewer(instanceId: number, reviewerId: number, actorId: number, at: number) {
  await run("UPDATE instances SET reviewer_id=? WHERE id=?", reviewerId, instanceId);
  const u = await one<{ name: string }>("SELECT name FROM users WHERE id=?", reviewerId);
  await logEvent(instanceId, at, actorId, "reassigned", `Reviewer: ${u?.name}`);
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

export async function remind(instanceIds: number[], actorId: number, at: number) {
  const people = new Set<number>();
  let skipped = 0;
  await tx(async () => {
    for (const id of instanceIds) {
      // Don't nag: skip a task that already got a reminder in the last 4 hours.
      if (await one("SELECT 1 FROM events WHERE instance_id=? AND type='reminder' AND at>?", id, at - 4 * HOUR)) { skipped++; continue; }
      const i = await one<Instance & { cbm_id: number | null }>(
        "SELECT i.*, p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", id);
      if (!i) continue;
      const who = nextActor(i, i.cbm_id);
      if (!who) continue;
      people.add(who);
      const u = await one<{ name: string }>("SELECT name FROM users WHERE id=?", who);
      await logEvent(id, at, actorId, "reminder", `Reminder sent to ${u?.name}`);
    }
  });
  return { people: people.size, skipped };
}
