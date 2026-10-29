import { all } from "./db";

export type Row = {
  id: number; template_id: number; property_id: number; task_date: string; window_start_at: number; window_end_at: number; late_until_at: number;
  status: string; attempt: number; status_since: number; first_submitted_at: number | null; last_submitted_at: number | null;
  first_decision: string | null; closed_at: number | null; source: string;
  task: string; category: string; op_role: string; criticality: string; review_sla_h: number; audit_sla_h: number; attempts_allowed: number;
  window_start: string; window_end: string;
  property: string; cluster: string; city: string;
  assignee_id: number | null; assignee: string | null; reviewer_id: number | null; reviewer: string | null;
  auditor_id: number | null; auditor: string | null; cbm_id: number | null; cbm: string | null;
  last_reason: string | null;
};

export const ROW_SQL = `
  SELECT i.*, t.name task, t.category, t.op_role, t.criticality, t.review_sla_h, t.audit_sla_h, t.attempts_allowed,
    t.window_start, t.window_end,
    p.name property, cl.name cluster, c.name city, p.cbm_id,
    ua.name assignee, ur.name reviewer, uu.name auditor, uc.name cbm,
    (SELECT f.reason FROM review_flags f JOIN reviews r ON r.id=f.review_id WHERE r.instance_id=i.id ORDER BY r.decided_at DESC LIMIT 1) last_reason
  FROM instances i
  JOIN templates t ON t.id=i.template_id
  JOIN properties p ON p.id=i.property_id
  JOIN clusters cl ON cl.id=p.cluster_id
  JOIN cities c ON c.id=cl.city_id
  LEFT JOIN users ua ON ua.id=i.assignee_id
  LEFT JOIN users ur ON ur.id=i.reviewer_id
  LEFT JOIN users uu ON uu.id=i.auditor_id
  LEFT JOIN users uc ON uc.id=p.cbm_id`;

export function rows(where: string, ...params: unknown[]): Row[] {
  return all<Row>(`${ROW_SQL} WHERE ${where}`, ...params);
}

export function geo() {
  return all<{ city: string; cluster: string; property: string; id: number }>(
    `SELECT c.name city, cl.name cluster, p.name property, p.id FROM properties p
     JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id ORDER BY c.name, cl.name, p.name`);
}

export function eventsFor(instanceId: number) {
  return all<{ id: number; at: number; type: string; detail: string; actor: string | null }>(
    `SELECT e.id, e.at, e.type, e.detail, u.name actor FROM events e LEFT JOIN users u ON u.id=e.actor_id
     WHERE e.instance_id=? ORDER BY e.at, e.id`, instanceId);
}

export { STATUS_LABEL, STATUS_PILL } from "./statuses";
