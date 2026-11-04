"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, currentUser, can, inScope, taskInScope, requireTasks } from "@/lib/auth";
import { all, one, run, tx } from "@/lib/db";
import * as E from "@/lib/engine";
import { km } from "@/lib/geo";
import { answerIssue, cleanOptionRules, cleanOptions } from "@/lib/answers";

type Result = { ok: true; msg?: string } | { ok: false; error: string };
async function guard(fn: () => Promise<string | void>): Promise<Result> {
  try {
    const msg = await fn();
    revalidatePath("/", "layout");
    return { ok: true, msg: msg || undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function signIn(form: FormData) {
  (await cookies()).set("uid", String(form.get("id")), { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

/** Where the person was when submitting: their phone's coordinates, the demo "simulate" button, or nothing. The distance is worked out here, not in the browser. */
export type Where = { lat: number; lng: number; acc?: number | null } | "simulated" | null;
/** A reading less precise than this is only a rough area (Wi-Fi, mobile tower or internet connection), not a position, so it can't pass or fail the check. */
const ROUGH_M = 1000;
export async function submitTask(instanceId: number, answers: E.AnswerInput[], where: Where): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const i = await one<E.Instance & { cbm_id: number }>("SELECT i.*, p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId);
    if (!i) throw new Error("Task not found.");
    if (i.assignee_id !== u.id && i.cbm_id !== u.id) throw new Error("Only the assignee or the property's CBM can submit this task.");
    const site = (await one<{ lat: number | null; lng: number | null; geofence_m: number }>(
      "SELECT p.lat, p.lng, t.geofence_m FROM properties p, templates t WHERE p.id=? AND t.id=?", i.property_id, i.template_id))!;
    let loc: E.Loc = { ok: null, distance: null, source: null };
    if (where === "simulated") loc = { ok: null, distance: null, source: "simulated" };
    else if (where && Number.isFinite(where.lat) && Number.isFinite(where.lng) && site.lat !== null && site.lng !== null) {
      const d = Math.round(km(site as { lat: number; lng: number }, where) * 1000);
      const acc = Number.isFinite(where.acc) && where.acc! > 0 ? Math.round(where.acc!) : null;
      loc = acc !== null && acc > ROUGH_M ? { ok: null, distance: d, source: "approx", accuracy: acc } : { ok: d <= site.geofence_m, distance: d, source: "gps", accuracy: acc };
    }
    // With Start/Stop on, the task must have been started first (a resubmission doesn't need a new start).
    if (i.status !== "changes" && (await one<{ s: number }>("SELECT start_stop s FROM templates WHERE id=?", i.template_id))?.s
      && !(await one("SELECT 1 FROM events WHERE instance_id=? AND type='started'", instanceId))) throw new Error("Tap Start task before filling in and submitting this task.");
    // Every item complete: compulsory photos and notes, an answer to each question, no negative numbers.
    const items = await E.itemsFor(i.template_id);
    const flagged = new Set(i.status === "changes" ? (await all<{ item_id: number }>(
      "SELECT f.item_id FROM review_flags f WHERE f.review_id=(SELECT id FROM reviews WHERE instance_id=? ORDER BY decided_at DESC LIMIT 1)", instanceId)).map((f) => f.item_id) : []);
    const byItem = new Map(answers.map((a) => [a.itemId, a]));
    const bad = items.map((it, ix) => [ix + 1, it, answerIssue(it, byItem.get(it.id), flagged.has(it.id))] as const).filter(([, , w]) => w);
    if (bad.length) throw new Error(`${bad.length === 1 ? "1 item isn't" : `${bad.length} items aren't`} complete. ${bad.slice(0, 3).map(([n, it, w]) => `Item ${n} (${it.label}): ${w}.`).join(" ")}`);
    await E.submit(instanceId, u.id, answers.map((a) => ({ ...a, value: a.value?.trim() ?? a.value, note: a.note?.trim() ?? a.note })), loc, Date.now());
    return "Submitted";
  });
}

export async function startTask(instanceId: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const i = await one<{ assignee_id: number | null; status: string; cbm_id: number | null }>(
      "SELECT i.assignee_id, i.status, p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId);
    if (!i || (i.assignee_id !== u.id && i.cbm_id !== u.id)) throw new Error("Only the person doing this task can start it.");
    if (!["current", "notsub"].includes(i.status)) throw new Error("This task can't be started right now.");
    if (!(await one("SELECT 1 FROM events WHERE instance_id=? AND type='started'", instanceId))) await E.logEvent(instanceId, Date.now(), u.id, "started", "Started the task");
  });
}

export async function reviewTask(instanceId: number, decision: "pass" | "changes", flags: E.FlagInput[], comment: string, openedAt: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers can review tasks.");
    if (decision === "changes" && !flags.length) throw new Error("Mark at least one item as Needs change.");
    if (decision === "changes" && flags.some((f) => !f.comment?.trim())) throw new Error("Add a comment to every flagged item so the CBM knows what to fix.");
    await E.reviewDecision(instanceId, u.id, decision, flags, comment, Date.now(), openedAt);
    return decision === "pass" ? "Passed" : "Sent back for changes";
  });
}

export async function auditTask(instanceId: number, decision: "pass" | "fail", flags: E.FlagInput[], comment: string): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["auditor", "admin"].includes(u.access_role)) throw new Error("Only auditors can audit tasks.");
    if (decision === "fail" && flags.some((f) => !f.comment?.trim())) throw new Error("Add a comment to every flagged item so the CBM knows what to fix.");
    await E.auditDecision(instanceId, u.id, decision, flags, comment, Date.now());
    return decision === "pass" ? "Audit passed" : "Audit failed, flags sent to the CBM";
  });
}

export async function answerFlags(instanceId: number, answers: Record<number, string>): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const p = await one<{ cbm_id: number }>("SELECT p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId);
    if (!p) throw new Error("Task not found.");
    if (p.cbm_id !== u.id && u.access_role !== "admin") throw new Error("Only the property's CBM can answer audit flags.");
    await E.answerAuditFlags(instanceId, u.id, answers, Date.now());
    return "Answers sent to the auditor";
  });
}

export async function closeFlags(instanceId: number, accept: boolean): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["auditor", "admin"].includes(u.access_role)) throw new Error("Only auditors can close audit flags.");
    await E.closeFlagAnswers(instanceId, u.id, accept, Date.now());
    return accept ? "Closed" : "Sent back to the CBM";
  });
}

/** Takes a task closed by weekend sampling back into review (reviewers, within the pull-back window). */
export async function pullBackTask(instanceId: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers can pull tasks back.");
    if ((await taskInScope(u, instanceId)) === null) throw new Error("That task isn't in your properties.");
    await E.pullBack(instanceId, u.id, Date.now());
    return "Back in review";
  });
}

export async function reopenTask(instanceId: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers can reopen tasks.");
    await E.reopen(instanceId, u.id, Date.now());
    return "Reopened";
  });
}

export async function waiveTask(instanceId: number, reason: string): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["cbm", "admin"].includes(u.access_role)) throw new Error("Only a CBM or admin can waive tasks.");
    await requireTasks(u, [instanceId]);
    await E.waive(instanceId, u.id, reason || "Waived", Date.now());
    return "Waived";
  });
}

export async function remindTasks(ids: number[]): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (u.access_role === "ground") throw new Error("Only CBMs and the central team can send reminders.");
    await requireTasks(u, ids);
    // Reviewers, auditors and CBMs remind the people doing the task; reminding another reviewer or auditor is the admin's call.
    const { people, skipped, self, peers } = await E.remind(ids, u.id, Date.now(), u.access_role !== "admin");
    if (!people && !skipped) throw new Error(self ? "That's waiting on you, so there's nobody to remind." : peers ? "Only an admin can remind a reviewer or auditor. You can escalate it instead." : "Nobody to remind on this task.");
    return `Reminder sent to ${people} ${people === 1 ? "person" : "people"}${skipped ? ` · ${skipped} skipped, already reminded in the last 4h` : ""}${self ? ` · ${self} waiting on you` : ""}${peers ? ` · ${peers} left for an admin` : ""}`;
  });
}

export async function reassignReviewer(ids: number[], reviewerId: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (u.access_role !== "admin") throw new Error("Only an admin can reassign reviewers.");
    const to = await one<{ access_role: string }>("SELECT access_role FROM users WHERE id=?", reviewerId);
    if (!to || !["reviewer", "admin"].includes(to.access_role)) throw new Error("Pick a reviewer.");
    await tx(async () => { for (const id of ids) await E.reassignReviewer(id, reviewerId, u.id, Date.now()); });
    return "Reassigned";
  });
}

export type ViewFilters = { city: string[]; cluster: string[]; prop: string[]; role: string[]; asg: string[]; cbm: string[]; rv: string[]; mine: boolean };
/** Saved filters, per screen. `filters` is whatever that screen keeps (the queue's lists, or a dashboard's URL parameters). */
export async function saveView(page: string, name: string, filters: object, isDefault: boolean): Promise<Result & { id?: number }> {
  const u = await requireUser();
  let id = 0;
  name = name.trim() || "My filters";
  const r = await guard(async () => {
    await tx(async () => {
      // Names are unique per person and page, ignoring case and extra spaces.
      if (await one("SELECT id FROM saved_views WHERE user_id=? AND page=? AND lower(trim(name))=lower(?)", u.id, page, name))
        throw new Error(`You already have saved filters called “${name}”. Pick another name.`);
      if (isDefault) await run("UPDATE saved_views SET is_default=0 WHERE user_id=? AND page=?", u.id, page);
      id = (await run("INSERT INTO saved_views (user_id, page, name, filters, is_default) VALUES (?,?,?,?,?)", u.id, page, name || "My filters", JSON.stringify(filters), isDefault ? 1 : 0)).lastInsertRowid;
    });
    return isDefault ? `Saved “${name}”. This page will open with it.` : `Saved “${name}”`;
  });
  return r.ok ? { ...r, id } : r;
}
export async function deleteView(id: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => { await run("DELETE FROM saved_views WHERE id=? AND user_id=?", id, u.id); return "Deleted"; });
}
export async function setDefaultView(id: number, on = true): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    await tx(async () => {
      const v = await one<{ page: string }>("SELECT page FROM saved_views WHERE id=? AND user_id=?", id, u.id);
      if (!v) throw new Error("Saved filter not found.");
      await run("UPDATE saved_views SET is_default=0 WHERE user_id=? AND page=?", u.id, v.page);
      if (on) await run("UPDATE saved_views SET is_default=1 WHERE id=?", id);
    });
    return on ? "This page now opens with it" : "No default for this page";
  });
}

export async function triggerTask(templateId: number, propertyId: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["cbm", "admin"].includes(u.access_role)) throw new Error("Only a CBM or admin can create tasks.");
    if (!(await inScope(u, propertyId))) throw new Error("That property isn't one of yours.");
    const t = await one<{ trigger: string; active: number }>("SELECT trigger, active FROM templates WHERE id=?", templateId);
    if (!t || t.trigger === "scheduled" || !t.active) throw new Error("That task can't be started by hand.");
    if (!(await one("SELECT 1 FROM template_properties WHERE template_id=? AND property_id=?", templateId, propertyId))) throw new Error("That task isn't set up for this property.");
    const id = await E.triggerEvent(templateId, propertyId, u.id, Date.now());
    if (!id) throw new Error("Couldn't create the task.");
    return "Task created and assigned";
  });
}

export type TemplateItemInput = { label: string; kind: string; photo_allowed: boolean; photo_required: boolean; note_allowed: boolean; note_required: boolean; count_of: string | null; guide?: string | null; options?: string[] | null; option_rules?: import("@/lib/answers").OptRules | null };
export type TemplateInput = Omit<E.Template, "id"> & { items: TemplateItemInput[]; properties: number[] };
/** Saves a task's setup. A new task's id comes back so the editor can confirm it and link to it. */
export async function saveTemplate(id: number | null, t: TemplateInput): Promise<Result & { id?: number }> {
  const u = await requireUser();
  if (!can.admin(u)) return { ok: false, error: "Only admins can edit task setup." };
  let newId = id;
  const r = await guard(async () => {
    if (!t.name.trim()) throw new Error("Give the task a name.");
    if (!id && !t.description?.trim()) throw new Error("Add a short description so the team knows what this task is for.");
    if (!t.items.length) throw new Error("Add at least one checklist item.");
    const bad = t.items.findIndex((it) => it.kind === "choice" && cleanOptions(it.options).length < 2);
    if (bad >= 0) throw new Error(`Item ${bad + 1} needs at least two options to pick from.`);
    if (t.trigger === "event" && !E.list<string>(t.events).length) throw new Error("Pick at least one event that creates this task.");
    if (t.trigger === "scheduled" && (t.frequency === "weekly" || t.frequency === "monthly") && !E.list(t.days).length) throw new Error("Pick at least one day it repeats on.");
    if (t.trigger === "scheduled" && t.frequency === "once" && !t.once_date) throw new Error("Pick the date it runs on.");
    if (t.window_end <= t.window_start) throw new Error("End time must be after start time.");
    if (t.geofence && (t.geofence_m < 10 || t.geofence_m > 1000)) throw new Error("Maximum distance must be 10 to 1000 metres.");
    if (!t.properties.length) throw new Error("Pick at least one property.");
    if (t.reviewer_id && t.reviewer_id === t.auditor_id) throw new Error("The auditor must be a different person from the reviewer.");
    await tx(async () => {
      const cols = ["name", "category", "op_role", "trigger", "event_name", "frequency", "weekday", "window_start", "window_end", "review_sla_h",
        "audit_sla_h", "attempts_allowed", "late_window_days", "criticality", "audit_rate", "geofence", "reviewer_id", "auditor_id", "active",
        "description", "events", "days", "once_date", "start_stop", "geofence_m", "ideal_minutes", "review_required", "assignees"] as const;
      const vals = cols.map((c) => (t as Record<string, unknown>)[c] ?? null);
      if (id) await run(`UPDATE templates SET ${cols.map((c) => `${c}=?`).join(", ")} WHERE id=?`, ...vals, id);
      else newId = Number((await run(`INSERT INTO templates (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...vals)).lastInsertRowid);
      // Items already answered are kept (renamed in place) so history stays readable; extra ones are appended.
      const existing = await all<{ id: number }>("SELECT id FROM template_items WHERE template_id=? ORDER BY pos", newId);
      for (const [pos, it] of t.items.entries()) {
        const rules = [it.label, it.kind, it.photo_required, it.note_required, it.photo_allowed || it.photo_required, it.note_allowed || it.note_required, it.kind === "count" ? it.count_of ?? "HK" : null, it.guide?.trim() || null,
          it.kind === "choice" ? JSON.stringify(cleanOptions(it.options)) : null,
          it.kind === "choice" && Object.keys(cleanOptionRules(it.option_rules, cleanOptions(it.options))).length ? JSON.stringify(cleanOptionRules(it.option_rules, cleanOptions(it.options))) : null];
        if (existing[pos]) await run("UPDATE template_items SET label=?, kind=?, photo_required=?, note_required=?, photo_allowed=?, note_allowed=?, count_of=?, guide=?, options=?, option_rules=?, pos=? WHERE id=?", ...rules, pos, existing[pos].id);
        else await run("INSERT INTO template_items (label, kind, photo_required, note_required, photo_allowed, note_allowed, count_of, guide, options, option_rules, template_id, pos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ...rules, newId, pos);
      }
      for (const ex of existing.slice(t.items.length)) {
        const used = await one("SELECT 1 FROM answers WHERE item_id=? LIMIT 1", ex.id);
        if (used) await run("UPDATE template_items SET pos=pos+1000 WHERE id=?", ex.id);
        else await run("DELETE FROM template_items WHERE id=?", ex.id);
      }
      const before = (await all<{ p: number }>("SELECT property_id p FROM template_properties WHERE template_id=?", newId)).map((x) => x.p);
      await run("DELETE FROM template_properties WHERE template_id=?", newId);
      for (const p of t.properties) await run("INSERT INTO template_properties VALUES (?,?)", newId, p);
      // Properties taken off the task stop getting it: runs there that nobody has submitted are dropped.
      await E.dropUpcoming(newId!, before.filter((p) => !t.properties.includes(p)));
    });
    return "Saved. New tasks follow this setup from the next window.";
  });
  return r.ok ? { ...r, id: newId ?? undefined } : r;
}

export async function getTaskDetail(instanceId: number) {
  const u = await requireUser();
  if (!can.dashboard(u) || (await taskInScope(u, instanceId)) === null) return null;
  const { taskDetail } = await import("@/lib/detail");
  return taskDetail(instanceId, u);
}

/** Marks open issues as seen by the current user. Cleared automatically when the task moves on. */
export async function acknowledgeIssues(ids: number[]): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!can.dashboard(u)) throw new Error("Only central roles can acknowledge issues.");
    await requireTasks(u, ids);
    await tx(async () => { for (const id of ids) await E.logEvent(id, Date.now(), u.id, "acknowledged", "Issue acknowledged"); });
    return `Acknowledged ${ids.length} ${ids.length === 1 ? "issue" : "issues"}`;
  });
}

/** Escalates an issue: ground team issues go to the property's CBM, everything else to the operations admin. */
export async function getHistory(instanceId: number) {
  const u = await requireUser();
  if ((await taskInScope(u, instanceId)) === null) return [];
  const { eventsFor } = await import("@/lib/queries");
  return eventsFor(instanceId, u.access_role);
}

export async function raiseEscalation(x: import("@/lib/escalations").EscInput): Promise<Result & { id?: number }> {
  const u = await requireUser();
  const X = await import("@/lib/escalations");
  let id = 0;
  const r = await guard(async () => {
    if (!X.canRaise(u)) throw new Error("Only the central team and CBMs can raise escalations.");
    id = await X.raise(u, x, Date.now());
    return `ESC-${id} raised to ${x.ownerName.trim()}`;
  });
  return r.ok ? { ...r, id } : r;
}

export async function updateEscalation(id: number, p: import("@/lib/escalations").EscPatch): Promise<Result> {
  const u = await requireUser();
  const X = await import("@/lib/escalations");
  return guard(async () => `ESC-${id}: ${await X.update(u, id, p, Date.now())}`);
}

// Team leave: a person's own weekly days off, leave and backup. Changes move affected tasks straight away.
async function afterAway() {
  const n = await E.coverAway(Date.now(), true);
  return n ? ` ${n} task${n > 1 ? "s" : ""} moved to cover or excused.` : "";
}
export async function saveWeekOff(userId: number, week: number[], backupId: number | null): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const T = await import("@/lib/team");
    const p = await T.personFor(u, userId);
    const days = [...new Set(week.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (days.length > 3) throw new Error("Pick at most 3 weekly days off.");
    if (backupId !== null && !(await T.backupOptions(u, p)).includes(backupId)) throw new Error("Pick a backup with the same role.");
    await run("UPDATE users SET week_off=?, backup_id=? WHERE id=?", JSON.stringify(days), backupId, userId);
    return `Saved ${p.name}'s week off and backup.${await afterAway()}`;
  });
}
export async function addLeave(userId: number, from: string, to: string, note: string): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const T = await import("@/lib/team");
    const { addDays, isoDate } = await import("@/lib/time");
    const p = await T.personFor(u, userId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to || from)) throw new Error("Pick the leave dates.");
    const end = to || from;
    if (end < from) throw new Error("The last day must be on or after the first day.");
    if (end < addDays(isoDate(Date.now()), -7)) throw new Error("That leave is more than a week ago.");
    if (end > addDays(from, 92)) throw new Error("Leave can be at most 3 months at a time.");
    if (await one("SELECT 1 FROM leaves WHERE user_id=? AND from_date<=? AND to_date>=?", userId, end, from)) throw new Error(`${p.name} already has leave on some of those days.`);
    await run("INSERT INTO leaves (user_id, from_date, to_date, note, by_id, at) VALUES (?,?,?,?,?,?)", userId, from, end, note.trim().slice(0, 80) || null, u.id, Date.now());
    return `Added leave for ${p.name}.${await afterAway()}`;
  });
}
export async function removeLeave(leaveId: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const T = await import("@/lib/team");
    const l = await one<{ user_id: number }>("SELECT user_id FROM leaves WHERE id=?", leaveId);
    if (!l) throw new Error("That leave was already removed.");
    const p = await T.personFor(u, l.user_id);
    await run("DELETE FROM leaves WHERE id=?", leaveId);
    await E.loadAway(true);
    return `Removed the leave for ${p.name}. Tasks already moved stay with whoever has them.`;
  });
}

/** The bell: newest notifications, unread count and fresh ones to pop up. Light on purpose: no sweep, it runs every few seconds. */
export async function myNotifications() {
  const u = await currentUser();
  if (!u) return null;
  const N = await import("@/lib/notify");
  return N.inbox(u.id, Date.now());
}

export async function readNotifications(ids: number[] | "all") {
  const u = await currentUser();
  if (!u) return;
  const N = await import("@/lib/notify");
  await N.markRead(u.id, ids === "all" ? "all" : ids.filter((x) => Number.isInteger(x)), Date.now());
}
