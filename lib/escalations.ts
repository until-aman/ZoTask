// Escalations: issues the central team raises with another team or person and follows until closed.
import { all, one, run, tx } from "./db";
import { DAY, isoDate, addDays } from "./time";
import { User, scopeProps } from "./auth";
import { geo } from "./queries";
import { logEvent } from "./engine";

export const DEPARTMENTS = ["R&M", "Housekeeping", "Staffing & HR", "Procurement", "Owner relations", "Sales", "IT & Tech", "Other"];
export const ESC_STATUS: Record<string, string> = { open: "Yet to start", wip: "In progress", done: "Closed", dropped: "Dropped" };
export const ESC_PILL: Record<string, string> = { open: "a", wip: "b", done: "g", dropped: "" };
export const PRIORITY: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
/** Days to expected closure when none is given. */
export const PRIORITY_DAYS: Record<string, number> = { high: 1, medium: 3, low: 7 };
/** Usual contact per department, offered when raising. Any name and email can be typed instead. */
export const TEAMS: Record<string, [string, string]> = {
  "R&M": ["R&M team", "rm@zolostays.com"], Housekeeping: ["Housekeeping lead", "hk.ops@zolostays.com"],
  "Staffing & HR": ["HR team", "hr@zolostays.com"], Procurement: ["Procurement team", "procurement@zolostays.com"],
  "Owner relations": ["Owner relations", "owners@zolostays.com"], Sales: ["Sales head", "sales@zolostays.com"], "IT & Tech": ["Tech support", "tech@zolostays.com"],
};
export const isOpen = (s: string) => s === "open" || s === "wip";
export const canRaise = (u: User) => ["admin", "reviewer", "auditor", "cbm"].includes(u.access_role);

export type EscInput = {
  department: string; title: string; detail: string; priority: string; propertyIds: number[];
  ownerName: string; ownerEmail: string; cc: string; due: string; mailSent: boolean; mailSubject: string; link: string; photos: string[]; instanceId: number | null;
};

export function raise(u: User, x: EscInput, now: number) {
  if (!x.title.trim()) throw new Error("Add what the issue is.");
  if (!x.propertyIds.length) throw new Error("Pick at least one property.");
  if (!x.ownerName.trim()) throw new Error("Add who it is raised to.");
  const due = x.due || addDays(isoDate(now), PRIORITY_DAYS[x.priority] ?? 3);
  const owner = one<{ id: number }>("SELECT id FROM users WHERE lower(email)=lower(?) OR name=?", x.ownerEmail.trim(), x.ownerName.trim());
  return tx(() => {
    const id = Number(run(`INSERT INTO escalations (department, title, detail, priority, status, raised_by, owner_name, owner_email, owner_id, cc, mail_subject, mail_sent_at, link, due_date, photos, instance_id, created_at, updated_at)
      VALUES (?,?,?,?, 'open', ?,?,?,?,?,?,?,?,?,?,?,?,?)`, x.department, x.title.trim(), x.detail.trim() || null, x.priority, u.id, x.ownerName.trim(), x.ownerEmail.trim() || null, owner?.id ?? null,
      x.cc.trim() || null, x.mailSubject.trim() || null, x.mailSent ? now : null, x.link.trim() || null, due, JSON.stringify(x.photos), x.instanceId, now, now).lastInsertRowid);
    for (const p of new Set(x.propertyIds)) run("INSERT INTO escalation_properties VALUES (?,?)", id, p);
    run("INSERT INTO escalation_updates (escalation_id, at, by_id, note, status, due_date) VALUES (?,?,?,?,?,?)", id, now, u.id, `Raised to ${x.ownerName.trim()}${x.mailSent ? ", email sent" : ""}`, "open", due);
    if (x.instanceId) logEvent(x.instanceId, now, u.id, "escalation_raised", `ESC-${id} to ${x.ownerName.trim()}: ${x.title.trim()}`);
    return id;
  });
}

export type EscPatch = { status?: string; due?: string; note?: string; mailSent?: boolean; mailSubject?: string; link?: string; ownerName?: string; ownerEmail?: string; photos?: string[] };

export function update(u: User, id: number, p: EscPatch, now: number) {
  const e = one<{ status: string; due_date: string | null; raised_by: number; owner_id: number | null; mail_sent_at: number | null; owner_name: string; photos: string }>("SELECT * FROM escalations WHERE id=?", id);
  if (!e) throw new Error("Escalation not found.");
  if (!["admin", "reviewer", "auditor"].includes(u.access_role) && e.raised_by !== u.id && e.owner_id !== u.id) throw new Error("Only the central team, the person who raised it or its owner can update this.");
  if (p.status && !ESC_STATUS[p.status]) throw new Error("Unknown status.");
  const parts: string[] = [];
  const status = p.status && p.status !== e.status ? p.status : null;
  const due = p.due && p.due !== e.due_date ? p.due : null;
  const owner = p.ownerName?.trim() && p.ownerName.trim() !== e.owner_name ? p.ownerName.trim() : null;
  if (status) parts.push(`Status: ${ESC_STATUS[status]}`);
  if (due) parts.push(`Expected closure moved to ${due}`);
  if (owner) parts.push(`Now with ${owner}`);
  if (p.mailSent && !e.mail_sent_at) parts.push("Email sent");
  if (p.photos?.length) parts.push(`${p.photos.length} photo${p.photos.length > 1 ? "s" : ""} added`);
  if (!parts.length && !p.note?.trim() && p.mailSubject === undefined && p.link === undefined) throw new Error("Nothing to update.");
  tx(() => {
    run(`UPDATE escalations SET status=coalesce(?, status), due_date=coalesce(?, due_date), owner_name=coalesce(?, owner_name), owner_email=CASE WHEN ? IS NULL THEN owner_email ELSE ? END,
      mail_sent_at=CASE WHEN ? AND mail_sent_at IS NULL THEN ? ELSE mail_sent_at END, mail_subject=coalesce(?, mail_subject), link=coalesce(?, link),
      photos=?, updated_at=?, closed_at=CASE WHEN ? IN ('done','dropped') THEN ? WHEN ? IN ('open','wip') THEN NULL ELSE closed_at END WHERE id=?`,
      status, due, owner, owner ? 1 : null, p.ownerEmail?.trim() || null, p.mailSent ? 1 : 0, now, p.mailSubject?.trim() || null, p.link?.trim() || null,
      JSON.stringify([...JSON.parse(e.photos), ...(p.photos ?? [])]), now, status, now, status, id);
    run("INSERT INTO escalation_updates (escalation_id, at, by_id, note, status, due_date) VALUES (?,?,?,?,?,?)", id, now, u.id,
      [parts.join(" · "), p.note?.trim()].filter(Boolean).join(" — ") || "Details updated", status, due);
  });
  return status ? ESC_STATUS[status] : "Updated";
}

type Raw = {
  id: number; department: string; title: string; detail: string | null; priority: string; status: string; raised_by: number; raiser: string;
  owner_name: string; owner_email: string | null; owner_id: number | null; cc: string | null; mail_subject: string | null; mail_sent_at: number | null; link: string | null;
  due_date: string | null; photos: string; instance_id: number | null; task: string | null; task_date: string | null; created_at: number; updated_at: number; closed_at: number | null;
};

export function escalationData(u: User, sp: Record<string, string | undefined>, now = Date.now()) {
  const scope = scopeProps(u);
  const G = geo().filter((g) => scope.includes(g.id));
  const byId = new Map(G.map((g) => [g.id, g]));
  const links = all<{ escalation_id: number; property_id: number }>("SELECT * FROM escalation_properties");
  const propsOf = new Map<number, number[]>();
  for (const l of links) propsOf.set(l.escalation_id, [...(propsOf.get(l.escalation_id) ?? []), l.property_id]);
  const central = ["admin", "reviewer", "auditor"].includes(u.access_role);
  const raw = all<Raw>(`SELECT e.*, ur.name raiser, t.name task, i.task_date FROM escalations e JOIN users ur ON ur.id=e.raised_by
    LEFT JOIN instances i ON i.id=e.instance_id LEFT JOIN templates t ON t.id=i.template_id ORDER BY e.created_at DESC`)
    .filter((e) => central || e.raised_by === u.id || e.owner_id === u.id || (propsOf.get(e.id) ?? []).some((p) => byId.has(p)));
  const ups = all<{ id: number; escalation_id: number; at: number; by: string | null; note: string | null; status: string | null; due_date: string | null }>(
    "SELECT x.id, x.escalation_id, x.at, u.name by, x.note, x.status, x.due_date FROM escalation_updates x LEFT JOIN users u ON u.id=x.by_id ORDER BY x.at");
  const upsOf = new Map<number, typeof ups>();
  for (const x of ups) upsOf.set(x.escalation_id, [...(upsOf.get(x.escalation_id) ?? []), x]);
  const today = isoDate(now);
  const rows = raw.map((e) => {
    const props = (propsOf.get(e.id) ?? []).map((p) => byId.get(p)).filter((g): g is NonNullable<typeof g> => !!g);
    const open = isOpen(e.status);
    const closedDay = e.closed_at ? isoDate(e.closed_at) : null;
    return {
      id: e.id, ref: `ESC-${e.id}`, department: e.department, title: e.title, detail: e.detail ?? "", priority: e.priority, status: e.status,
      raisedBy: e.raiser, raisedById: e.raised_by, owner: e.owner_name, ownerEmail: e.owner_email ?? "", ownerId: e.owner_id, cc: e.cc ?? "",
      mailSubject: e.mail_subject ?? "", mailSentAt: e.mail_sent_at, link: e.link ?? "", due: e.due_date, photos: JSON.parse(e.photos) as string[],
      instanceId: e.instance_id, task: e.task ? `${e.task} · ${e.task_date}` : null, created: e.created_at, updated: e.updated_at, closed: e.closed_at,
      props: props.map((g) => ({ id: g.id, name: g.property, cluster: g.cluster, city: g.city })),
      overdue: open && !!e.due_date && e.due_date < today,
      onTime: e.status === "done" && closedDay !== null ? !e.due_date || closedDay <= e.due_date : null,
      updates: upsOf.get(e.id) ?? [],
      canEdit: central || e.raised_by === u.id || e.owner_id === u.id,
    };
  });
  // Prefill when raising from a task.
  const fromTask = sp.task ? one<{ id: number; property_id: number; task: string; task_date: string; category: string; property: string }>(
    `SELECT i.id, i.property_id, t.name task, i.task_date, t.category, p.name property FROM instances i JOIN templates t ON t.id=i.template_id JOIN properties p ON p.id=i.property_id WHERE i.id=?`, Number(sp.task)) ?? null : null;
  const people = all<{ id: number; name: string; email: string; access_role: string }>("SELECT id, name, email, access_role FROM users WHERE access_role IN ('admin','cbm','reviewer','auditor') ORDER BY name");
  return {
    now, today, rows, geo: G, people, teams: TEAMS, departments: DEPARTMENTS,
    canRaise: canRaise(u), me: u.name, openNew: sp.new === "1" || !!fromTask,
    fromTask: fromTask && scope.includes(fromTask.property_id) ? fromTask : null,
  };
}
export type EscData = ReturnType<typeof escalationData>;
export type Esc = EscData["rows"][number];

/** Sample escalations like the ones the central team keeps in sheets today. */
export function seedEscalations(now = Date.now()) {
  const users = all<{ id: number; name: string; access_role: string; email: string }>("SELECT id, name, access_role, email FROM users");
  const raisers = users.filter((x) => ["reviewer", "auditor"].includes(x.access_role));
  const props = all<{ id: number; name: string; cbm_id: number }>("SELECT id, name, cbm_id FROM properties ORDER BY id");
  if (!raisers.length || !props.length) return;
  let s = 99;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const ITEMS: [string, string, string, string][] = [
    ["R&M", "Long-pending R&M tickets", "Open R&M tickets older than 2 weeks across the cluster. Residents are following up daily.", "high"],
    ["Housekeeping", "HK staff without uniform", "2 HK staff have been without uniform for almost a month due to shortage of uniforms.", "medium"],
    ["Staffing & HR", "Shortage of 1 HK staff", "As per the CBM workflow 5 HK staff should be on site but only 4 are there.", "high"],
    ["Procurement", "Large dustbins needed", "Garbage is stored in front of the property without a dustbin because the vendor collects it there.", "medium"],
    ["Owner relations", "Cracked tiles in model room", "CBM asked the owner to fix it. Owner asked for 15 days.", "low"],
    ["R&M", "Washing machine repair", "The washing machine is leaking water and not in working condition.", "high"],
    ["R&M", "Kitchen walls need painting", "The kitchen walls are in a very bad condition and need to be painted.", "low"],
    ["Procurement", "Microwave fully rusted", "Microwave in the pantry is rusted and unsafe to use.", "medium"],
    ["Housekeeping", "Model room deep cleaning", "The bathroom commode and tiles need deep cleaning before visits.", "medium"],
    ["Staffing & HR", "HK staff on leave, no cover", "No HK at the property since the only HK went on leave.", "high"],
    ["Sales", "Review rating dropped", "Google rating went from 4.3 to 4.0 in two weeks. Need a plan for resident reviews.", "low"],
    ["IT & Tech", "Biometric attendance not syncing", "Attendance device has not synced for 3 days, attendance can't be verified.", "medium"],
    ["R&M", "Water leakage on 3rd floor", "Seepage from the terrace into two rooms on the 3rd floor after rain.", "high"],
    ["Housekeeping", "Garbage not cleared on time", "Garbage check failed 4 times this week. Vendor timing does not match the shift.", "medium"],
    ["Procurement", "Room tagging pending", "Room tags missing for new rooms, residents can't find rooms.", "low"],
  ];
  const instFor = (pid: number, day: string) => one<{ id: number }>("SELECT id FROM instances WHERE property_id=? AND task_date=? ORDER BY random() LIMIT 1", pid, day)?.id ?? null;
  tx(() => {
    for (let k = 0; k < 34; k++) {
      const [dept, title, detail, prio] = ITEMS[k % ITEMS.length];
      const created = now - Math.floor((2 + R() * 28) * DAY * (k < 8 ? 0.25 : 1)) - Math.floor(R() * 8) * 3600_000;
      const p = pick(props), multi = R() < 0.2 ? [p.id, pick(props).id] : [p.id];
      const by = pick(raisers);
      const cbm = users.find((x) => x.id === p.cbm_id);
      const [owner, email] = dept === "Other" || R() < 0.15 ? [cbm?.name ?? "CBM", cbm?.email ?? ""] : TEAMS[dept];
      const due = addDays(isoDate(created), PRIORITY_DAYS[prio] + Math.floor(R() * 3));
      const age = (now - created) / DAY;
      const roll = R();
      const status = age > 6 ? (roll < 0.62 ? "done" : roll < 0.68 ? "dropped" : roll < 0.86 ? "wip" : "open") : roll < 0.3 ? "done" : roll < 0.65 ? "wip" : "open";
      const closeAt = status === "done" || status === "dropped" ? Math.min(now - 3600_000, created + (0.4 + R() * (R() < 0.35 ? 9 : 4)) * DAY) : null;
      const mailed = R() < 0.85 ? created + 1800_000 : null;
      const inst = R() < 0.45 ? instFor(p.id, isoDate(created)) : null;
      const id = Number(run(`INSERT INTO escalations (department, title, detail, priority, status, raised_by, owner_name, owner_email, owner_id, cc, mail_subject, mail_sent_at, link, due_date, photos, instance_id, created_at, updated_at, closed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, dept, `${title} - ${p.name}`, detail, prio, status, by.id, owner, email, users.find((x) => x.email === email)?.id ?? null,
        owner === cbm?.name ? null : cbm?.email ?? null, mailed ? `${dept === "R&M" ? "Escalation" : "Request"}: ${title} || ${p.name}` : null, mailed, null, due, "[]", inst, created, closeAt ?? created + 3600_000, closeAt).lastInsertRowid);
      for (const pid of new Set(multi)) run("INSERT INTO escalation_properties VALUES (?,?)", id, pid);
      run("INSERT INTO escalation_updates (escalation_id, at, by_id, note, status, due_date) VALUES (?,?,?,?,?,?)", id, created, by.id, `Raised to ${owner}${mailed ? ", email sent" : ""}`, "open", due);
      if (status !== "open") {
        const at = closeAt ? created + (closeAt - created) / 2 : created + Math.min(age, 2) * DAY / 2;
        run("INSERT INTO escalation_updates (escalation_id, at, by_id, note, status) VALUES (?,?,?,?,?)", id, at, by.id, `Status: In progress — ${pick(["Vendor visit scheduled", "Owner informed, waiting for approval", "Quote received, approval pending", "Team has acknowledged"])}`, "wip");
      }
      if (closeAt) run("INSERT INTO escalation_updates (escalation_id, at, by_id, note, status) VALUES (?,?,?,?,?)", id, closeAt, by.id,
        status === "done" ? `Status: Closed — ${pick(["Fixed and verified with photo", "Staff joined", "Delivered at property", "Resolved, CBM confirmed"])}` : "Status: Dropped — Not needed any more", status);
      if (inst) logEvent(inst, created, by.id, "escalation_raised", `ESC-${id} to ${owner}: ${title}`);
    }
  });
}
