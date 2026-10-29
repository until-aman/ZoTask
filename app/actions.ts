"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { all, one, run, tx } from "@/lib/db";
import * as E from "@/lib/engine";

type Result = { ok: true; msg?: string } | { ok: false; error: string };
function guard(fn: () => string | void): Result {
  try {
    const msg = fn();
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
  return guard(() => {
    const i = one<E.Instance & { cbm_id: number }>("SELECT i.*, p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId)!;
    if (i.assignee_id !== u.id && i.cbm_id !== u.id) throw new Error("Only the assignee or the property's CBM can submit this task.");
    E.submit(instanceId, u.id, answers, loc, Date.now());
    return "Submitted";
  });
}

export async function reviewTask(instanceId: number, decision: "pass" | "changes", flags: E.FlagInput[], comment: string, openedAt: number): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers can review tasks.");
    E.reviewDecision(instanceId, u.id, decision, flags, comment, Date.now(), openedAt);
    return decision === "pass" ? "Passed" : "Sent back for changes";
  });
}

export async function auditTask(instanceId: number, decision: "pass" | "fail", flags: E.FlagInput[], comment: string): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["auditor", "admin"].includes(u.access_role)) throw new Error("Only auditors can audit tasks.");
    E.auditDecision(instanceId, u.id, decision, flags, comment, Date.now());
    return decision === "pass" ? "Audit passed" : "Audit failed, flags sent to the CBM";
  });
}

export async function answerFlags(instanceId: number, answers: Record<number, string>): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    const p = one<{ cbm_id: number }>("SELECT p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId)!;
    if (p.cbm_id !== u.id && u.access_role !== "admin") throw new Error("Only the property's CBM can answer audit flags.");
    E.answerAuditFlags(instanceId, u.id, answers, Date.now());
    return "Answers sent to the auditor";
  });
}

export async function closeFlags(instanceId: number, accept: boolean): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["auditor", "admin"].includes(u.access_role)) throw new Error("Only auditors can close audit flags.");
    E.closeFlagAnswers(instanceId, u.id, accept, Date.now());
    return accept ? "Closed" : "Sent back to the CBM";
  });
}

export async function reopenTask(instanceId: number): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers can reopen tasks.");
    E.reopen(instanceId, u.id, Date.now());
    return "Reopened";
  });
}

export async function waiveTask(instanceId: number, reason: string): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["cbm", "admin"].includes(u.access_role)) throw new Error("Only a CBM or admin can waive tasks.");
    E.waive(instanceId, u.id, reason || "Waived", Date.now());
    return "Waived";
  });
}

export async function remindTasks(ids: number[]): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    const { people, skipped } = E.remind(ids, u.id, Date.now());
    return `Reminder logged for ${people} ${people === 1 ? "person" : "people"}${skipped ? ` · ${skipped} skipped, already reminded in the last 4h` : ""}`;
  });
}

export async function reassignReviewer(ids: number[], reviewerId: number): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["reviewer", "admin"].includes(u.access_role)) throw new Error("Only reviewers and admins can reassign.");
    tx(() => ids.forEach((id) => E.reassignReviewer(id, reviewerId, u.id, Date.now())));
    return "Reassigned";
  });
}

export type ViewFilters = { city: string[]; cluster: string[]; prop: string[]; role: string[]; asg: string[]; mine: boolean };
export async function saveView(name: string, filters: ViewFilters, isDefault: boolean): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    tx(() => {
      if (isDefault) run("UPDATE saved_views SET is_default=0 WHERE user_id=?", u.id);
      run("INSERT INTO saved_views (user_id, name, filters, is_default) VALUES (?,?,?,?)", u.id, name || "My filters", JSON.stringify(filters), isDefault ? 1 : 0);
    });
    return isDefault ? "Saved. The queue will open with these filters every day." : "Saved";
  });
}
export async function deleteView(id: number): Promise<Result> {
  const u = await requireUser();
  return guard(() => { run("DELETE FROM saved_views WHERE id=? AND user_id=?", id, u.id); });
}
export async function setDefaultView(id: number): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    tx(() => {
      run("UPDATE saved_views SET is_default=0 WHERE user_id=?", u.id);
      run("UPDATE saved_views SET is_default=1 WHERE id=? AND user_id=?", id, u.id);
    });
  });
}

export async function triggerTask(templateId: number, propertyId: number): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["cbm", "admin"].includes(u.access_role)) throw new Error("Only a CBM or admin can create tasks.");
    const id = E.triggerEvent(templateId, propertyId, u.id, Date.now());
    if (!id) throw new Error("Couldn't create the task.");
    return "Task created and assigned";
  });
}

export type TemplateInput = Omit<E.Template, "id"> & { items: { label: string; kind: string; photo_required: boolean; note_required: boolean }[]; properties: number[] };
export async function saveTemplate(id: number | null, t: TemplateInput): Promise<Result> {
  const u = await requireUser();
  if (!can.admin(u)) return { ok: false, error: "Only admins can edit task setup." };
  let newId = id;
  const r = guard(() => {
    if (!t.name.trim()) throw new Error("Give the task a name.");
    if (!t.items.length) throw new Error("Add at least one checklist item.");
    if (t.reviewer_id && t.reviewer_id === t.auditor_id) throw new Error("The auditor must be a different person from the reviewer.");
    tx(() => {
      const cols = ["name", "category", "op_role", "trigger", "event_name", "frequency", "weekday", "window_start", "window_end", "review_sla_h",
        "audit_sla_h", "attempts_allowed", "late_window_days", "criticality", "audit_rate", "geofence", "reviewer_id", "auditor_id", "active"] as const;
      const vals = cols.map((c) => (t as Record<string, unknown>)[c] ?? null);
      if (id) run(`UPDATE templates SET ${cols.map((c) => `${c}=?`).join(", ")} WHERE id=?`, ...vals, id);
      else newId = Number(run(`INSERT INTO templates (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...vals).lastInsertRowid);
      // Items already answered are kept (renamed in place) so history stays readable; extra ones are appended.
      const existing = all<{ id: number }>("SELECT id FROM template_items WHERE template_id=? ORDER BY pos", newId);
      t.items.forEach((it, pos) => {
        if (existing[pos]) run("UPDATE template_items SET label=?, kind=?, photo_required=?, note_required=?, pos=? WHERE id=?",
          it.label, it.kind, it.photo_required ? 1 : 0, it.note_required ? 1 : 0, pos, existing[pos].id);
        else run("INSERT INTO template_items (template_id, pos, label, kind, photo_required, note_required) VALUES (?,?,?,?,?,?)",
          newId, pos, it.label, it.kind, it.photo_required ? 1 : 0, it.note_required ? 1 : 0);
      });
      for (const ex of existing.slice(t.items.length)) {
        const used = one("SELECT 1 FROM answers WHERE item_id=? LIMIT 1", ex.id);
        if (used) run("UPDATE template_items SET pos=pos+1000 WHERE id=?", ex.id);
        else run("DELETE FROM template_items WHERE id=?", ex.id);
      }
      run("DELETE FROM template_properties WHERE template_id=?", newId);
      for (const p of t.properties) run("INSERT INTO template_properties VALUES (?,?)", newId, p);
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
  return guard(() => {
    if (!can.dashboard(u)) throw new Error("Only central roles can acknowledge issues.");
    tx(() => ids.forEach((id) => E.logEvent(id, Date.now(), u.id, "acknowledged", "Issue acknowledged")));
    return `Acknowledged ${ids.length} ${ids.length === 1 ? "issue" : "issues"}`;
  });
}

/** Escalates an issue: ground team issues go to the property's CBM, everything else to the operations admin. */
export async function escalateIssue(id: number, note: string): Promise<Result> {
  const u = await requireUser();
  return guard(() => {
    if (!["admin", "reviewer", "auditor"].includes(u.access_role)) throw new Error("Only central operations can escalate.");
    const i = one<{ status: string; cbm: string | null }>("SELECT i.status, uc.name cbm FROM instances i JOIN properties p ON p.id=i.property_id LEFT JOIN users uc ON uc.id=p.cbm_id WHERE i.id=?", id);
    if (!i) throw new Error("Task not found.");
    const to = ["notsub", "changes"].includes(i.status) ? i.cbm ?? "CBM" : one<{ name: string }>("SELECT name FROM users WHERE access_role='admin' LIMIT 1")?.name ?? "Ops Admin";
    E.logEvent(id, Date.now(), u.id, "escalated", `Escalated to ${to}${note.trim() ? ` · ${note.trim()}` : ""}`);
    return `Escalated to ${to}`;
  });
}

export async function getHistory(instanceId: number) {
  await requireUser();
  const { eventsFor } = await import("@/lib/queries");
  return eventsFor(instanceId);
}
