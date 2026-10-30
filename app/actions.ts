"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { all, one, run, tx } from "@/lib/db";
import * as E from "@/lib/engine";

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

export async function submitTask(instanceId: number, answers: E.AnswerInput[], loc: { ok: boolean | null; distance: number | null }): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const i = (await one<E.Instance & { cbm_id: number }>("SELECT i.*, p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId))!;
    if (i.assignee_id !== u.id && i.cbm_id !== u.id) throw new Error("Only the assignee or the property's CBM can submit this task.");
    await E.submit(instanceId, u.id, answers, loc, Date.now());
    return "Submitted";
  });
}

export async function reviewTask(instanceId: number, decision: "pass" | "changes", flags: E.FlagInput[], comment: string, openedAt: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers can review tasks.");
    await E.reviewDecision(instanceId, u.id, decision, flags, comment, Date.now(), openedAt);
    return decision === "pass" ? "Passed" : "Sent back for changes";
  });
}

export async function auditTask(instanceId: number, decision: "pass" | "fail", flags: E.FlagInput[], comment: string): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["auditor", "admin"].includes(u.access_role)) throw new Error("Only auditors can audit tasks.");
    await E.auditDecision(instanceId, u.id, decision, flags, comment, Date.now());
    return decision === "pass" ? "Audit passed" : "Audit failed, flags sent to the CBM";
  });
}

export async function answerFlags(instanceId: number, answers: Record<number, string>): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const p = (await one<{ cbm_id: number }>("SELECT p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId))!;
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
    await E.waive(instanceId, u.id, reason || "Waived", Date.now());
    return "Waived";
  });
}

export async function remindTasks(ids: number[]): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    const { people, skipped } = await E.remind(ids, u.id, Date.now());
    return `Reminder logged for ${people} ${people === 1 ? "person" : "people"}${skipped ? ` · ${skipped} skipped, already reminded in the last 4h` : ""}`;
  });
}

export async function reassignReviewer(ids: number[], reviewerId: number): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers and admins can reassign.");
    await tx(async () => { for (const id of ids) await E.reassignReviewer(id, reviewerId, u.id, Date.now()); });
    return "Reassigned";
  });
}

export type ViewFilters = { city: string[]; cluster: string[]; prop: string[]; role: string[]; asg: string[]; cbm: string[]; rv: string[]; mine: boolean };
/** Saved filters, per screen. `filters` is whatever that screen keeps (the queue's lists, or a dashboard's URL parameters). */
export async function saveView(page: string, name: string, filters: object, isDefault: boolean): Promise<Result & { id?: number }> {
  const u = await requireUser();
  let id = 0;
  const r = await guard(async () => {
    await tx(async () => {
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
    const id = await E.triggerEvent(templateId, propertyId, u.id, Date.now());
    if (!id) throw new Error("Couldn't create the task.");
    return "Task created and assigned";
  });
}

export type TemplateInput = Omit<E.Template, "id"> & { items: { label: string; kind: string; photo_required: boolean; note_required: boolean }[]; properties: number[] };
export async function saveTemplate(id: number | null, t: TemplateInput): Promise<Result> {
  const u = await requireUser();
  if (!can.admin(u)) return { ok: false, error: "Only admins can edit task setup." };
  let newId = id;
  const r = await guard(async () => {
    if (!t.name.trim()) throw new Error("Give the task a name.");
    if (!t.items.length) throw new Error("Add at least one checklist item.");
    if (t.reviewer_id && t.reviewer_id === t.auditor_id) throw new Error("The auditor must be a different person from the reviewer.");
    await tx(async () => {
      const cols = ["name", "category", "op_role", "trigger", "event_name", "frequency", "weekday", "window_start", "window_end", "review_sla_h",
        "audit_sla_h", "attempts_allowed", "late_window_days", "criticality", "audit_rate", "geofence", "reviewer_id", "auditor_id", "active"] as const;
      const vals = cols.map((c) => (t as Record<string, unknown>)[c] ?? null);
      if (id) await run(`UPDATE templates SET ${cols.map((c) => `${c}=?`).join(", ")} WHERE id=?`, ...vals, id);
      else newId = Number((await run(`INSERT INTO templates (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...vals)).lastInsertRowid);
      // Items already answered are kept (renamed in place) so history stays readable; extra ones are appended.
      const existing = await all<{ id: number }>("SELECT id FROM template_items WHERE template_id=? ORDER BY pos", newId);
      for (const [pos, it] of t.items.entries()) {
        if (existing[pos]) await run("UPDATE template_items SET label=?, kind=?, photo_required=?, note_required=?, pos=? WHERE id=?",
          it.label, it.kind, it.photo_required ? 1 : 0, it.note_required ? 1 : 0, pos, existing[pos].id);
        else await run("INSERT INTO template_items (template_id, pos, label, kind, photo_required, note_required) VALUES (?,?,?,?,?,?)",
          newId, pos, it.label, it.kind, it.photo_required ? 1 : 0, it.note_required ? 1 : 0);
      }
      for (const ex of existing.slice(t.items.length)) {
        const used = await one("SELECT 1 FROM answers WHERE item_id=? LIMIT 1", ex.id);
        if (used) await run("UPDATE template_items SET pos=pos+1000 WHERE id=?", ex.id);
        else await run("DELETE FROM template_items WHERE id=?", ex.id);
      }
      await run("DELETE FROM template_properties WHERE template_id=?", newId);
      for (const p of t.properties) await run("INSERT INTO template_properties VALUES (?,?)", newId, p);
    });
    return "Saved. New tasks follow this setup from the next window.";
  });
  if (r.ok && !id) redirect(`/admin/templates/${newId}`);
  return r;
}

export async function getTaskDetail(instanceId: number) {
  const u = await requireUser();
  if (!can.dashboard(u)) return null;
  const { taskDetail } = await import("@/lib/detail");
  return taskDetail(instanceId, u);
}

/** Marks open issues as seen by the current user. Cleared automatically when the task moves on. */
export async function acknowledgeIssues(ids: number[]): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!can.dashboard(u)) throw new Error("Only central roles can acknowledge issues.");
    await tx(async () => { for (const id of ids) await E.logEvent(id, Date.now(), u.id, "acknowledged", "Issue acknowledged"); });
    return `Acknowledged ${ids.length} ${ids.length === 1 ? "issue" : "issues"}`;
  });
}

/** Escalates an issue: ground team issues go to the property's CBM, everything else to the operations admin. */
export async function escalateIssue(id: number, note: string): Promise<Result> {
  const u = await requireUser();
  return guard(async () => {
    if (!["admin", "reviewer", "auditor"].includes(u.access_role)) throw new Error("Only central operations can escalate.");
    const i = await one<{ status: string; cbm: string | null }>("SELECT i.status, uc.name cbm FROM instances i JOIN properties p ON p.id=i.property_id LEFT JOIN users uc ON uc.id=p.cbm_id WHERE i.id=?", id);
    if (!i) throw new Error("Task not found.");
    const to = ["notsub", "changes"].includes(i.status) ? i.cbm ?? "CBM" : (await one<{ name: string }>("SELECT name FROM users WHERE access_role='admin' LIMIT 1"))?.name ?? "Ops Admin";
    await E.logEvent(id, Date.now(), u.id, "escalated", `Escalated to ${to}${note.trim() ? ` · ${note.trim()}` : ""}`);
    return `Escalated to ${to}`;
  });
}

export async function getHistory(instanceId: number) {
  await requireUser();
  const { eventsFor } = await import("@/lib/queries");
  return eventsFor(instanceId);
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
