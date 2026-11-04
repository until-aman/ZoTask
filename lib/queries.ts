import { all } from "./db";
import { ACTION_EVENTS } from "./statuses";

const ACTION_IN = ACTION_EVENTS.map((t) => `'${t}'`).join(",");

export type Row = {
  id: number; template_id: number; property_id: number; task_date: string; window_start_at: number; window_end_at: number; late_until_at: number;
  status: string; attempt: number; status_since: number; first_submitted_at: number | null; last_submitted_at: number | null;
  first_decision: string | null; closed_at: number | null; source: string;
  wk: string | null; wk_why: string | null; wk_closed_at: number | null;
  task: string; category: string; op_role: string; criticality: string; review_sla_h: number; audit_sla_h: number; attempts_allowed: number;
  window_start: string; window_end: string;
  property: string; cluster: string; city: string;
  assignee_id: number | null; assignee: string | null; reviewer_id: number | null; reviewer: string | null;
  auditor_id: number | null; auditor: string | null; cbm_id: number | null; cbm: string | null;
  last_reason: string | null;
  /** The latest step that moved the task (submitted, reviewed, resubmitted...) and when. */
  last_type: string | null; last_at: number | null;
};

export const ROW_SQL = `
  SELECT i.*, t.name task, t.category, t.op_role, t.criticality, t.review_sla_h, t.audit_sla_h, t.attempts_allowed,
    t.window_start, t.window_end,
    p.name property, cl.name cluster, c.name city, p.cbm_id,
    ua.name assignee, ur.name reviewer, uu.name auditor, uc.name cbm,
    (SELECT f.reason FROM review_flags f JOIN reviews r ON r.id=f.review_id WHERE r.instance_id=i.id ORDER BY r.decided_at DESC LIMIT 1) last_reason,
    (SELECT e.type FROM events e WHERE e.instance_id=i.id AND e.type IN (${ACTION_IN}) ORDER BY e.at DESC, e.id DESC LIMIT 1) last_type,
    (SELECT max(e.at) FROM events e WHERE e.instance_id=i.id AND e.type IN (${ACTION_IN})) last_at
  FROM instances i
  JOIN templates t ON t.id=i.template_id
  JOIN properties p ON p.id=i.property_id
  JOIN clusters cl ON cl.id=p.cluster_id
  JOIN cities c ON c.id=cl.city_id
  LEFT JOIN users ua ON ua.id=i.assignee_id
  LEFT JOIN users ur ON ur.id=i.reviewer_id
  LEFT JOIN users uu ON uu.id=i.auditor_id
  LEFT JOIN users uc ON uc.id=p.cbm_id`;

export async function rows(where: string, ...params: unknown[]): Promise<Row[]> {
  return await all<Row>(`${ROW_SQL} WHERE ${where}`, ...params);
}

export async function geo() {
  return await all<{ city: string; cluster: string; property: string; id: number; cbmId: number | null; cbm: string }>(
    `SELECT c.name city, cl.name cluster, p.name property, p.id, p.cbm_id cbmId, COALESCE(u.name, '') cbm FROM properties p
     JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id LEFT JOIN users u ON u.id=p.cbm_id ORDER BY c.name, cl.name, p.name`);
}

// Decisions by the central team. CBMs and the ground team see them signed by the team, not the person, so a check by
// hand and a task closed by weekend sampling read the same to them; the sampling note itself is never shown to them.
const TEAM: Record<string, string> = { passed: "Review team", changes_requested: "Review team", reopened: "Review team", reassigned: "Review team",
  audit_passed: "Audit team", audit_failed: "Audit team", flags_closed: "Audit team", flags_reopened: "Audit team" };
const CENTRAL_ONLY = ["weekend_closed"];
export const isCentralRole = (role: string) => ["admin", "reviewer", "auditor"].includes(role);

export async function eventsFor(instanceId: number, viewerRole = "admin") {
  const ev = await all<{ id: number; at: number; type: string; detail: string; actor: string | null }>(
    `SELECT e.id, e.at, e.type, e.detail, u.name actor FROM events e LEFT JOIN users u ON u.id=e.actor_id
     WHERE e.instance_id=? ORDER BY e.at, e.id`, instanceId);
  if (isCentralRole(viewerRole)) return ev;
  return ev.filter((e) => !CENTRAL_ONLY.includes(e.type)).map((e) => (TEAM[e.type] ? { ...e, actor: TEAM[e.type] } : e));
}

export { STATUS_LABEL, STATUS_PILL } from "./statuses";
