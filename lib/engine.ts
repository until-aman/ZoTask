// Task lifecycle: instance generation, time-based sweeps, submit, review, audit.
import { all, batch, one, run, tx } from "./db";
import { notify, taskTitle } from "./notify";
import { DAY, HOUR, addDays, atTime, isoDate, weekday } from "./time";
import { addWork, autoCloseAt, awayCacheFresh, awayMap, coverFor, forPerson, isOff, normOff, offCacheFresh, offCfg, personOffWhy, setAwayCache, setOffCache, type OffCfg, type PersonOff } from "./offdays";

export const REASONS = ["Photo missing", "Photo unclear", "Wrong location", "Count mismatch", "Item not done", "Other"];
export const GEOFENCE_M = 200;

export type Template = {
  id: number; name: string; category: string; op_role: string; trigger: string; event_name: string | null;
  frequency: string; weekday: number | null; window_start: string; window_end: string;
  review_sla_h: number; audit_sla_h: number; attempts_allowed: number; late_window_days: number;
  criticality: string; audit_rate: number; geofence: number; reviewer_id: number | null; auditor_id: number | null; active: number;
  description: string | null; events: string; days: string; once_date: string | null; start_stop: number; geofence_m: number;
  ideal_minutes: number | null; review_required: number; assignees: string;
};
export type Item = {
  id: number; template_id: number; pos: number; label: string; kind: string; photo_required: number; note_required: number;
  photo_allowed: number; note_allowed: number; count_of: string | null; guide?: string | null; options?: string | null; option_rules?: string | null;
};
export const list = <T = number>(s: string | null | undefined): T[] => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export type Instance = {
  id: number; template_id: number; property_id: number; task_date: string; window_start_at: number; window_end_at: number;
  late_until_at: number; assignee_id: number | null; reviewer_id: number | null; auditor_id: number | null; status: string;
  attempt: number; first_submitted_at: number | null; last_submitted_at: number | null; status_since: number;
  first_decision: string | null; closed_at: number | null; source: string;
  /** Submitted on a reviewer day off: "must" (in the Weekend list to check) or "auto" (closes by itself unless someone checks it). */
  wk: string | null; wk_why: string | null; wk_closed_at: number | null;
};

/** Reviewer week-off settings (Admin → Week offs), cached for 30 seconds. */
export async function loadOff(force = false): Promise<OffCfg> {
  if (!force && offCacheFresh()) return offCfg();
  const v = await one<{ v: string }>("SELECT v FROM meta WHERE k='offdays'");
  let c: OffCfg;
  try { c = normOff(v ? JSON.parse(v.v) : null); } catch { c = normOff(null); }
  setOffCache(c);
  return c;
}

/** For a submission on a reviewer day off: must it be checked, and why? Critical tasks, anything the system already
 *  flags (missing evidence, late, away from the property, a count below the ideal) and a random share are checked;
 *  the rest close by themselves. Nothing here is shown to the CBM. */
async function weekendPick(c: OffCfg, i: Instance, t: Template, sid: number, at: number, loc: Loc, resub: boolean): Promise<{ wk: string; why: string }> {
  const why: string[] = [];
  if (t.criticality === "high") why.push("Critical");
  if (resub) why.push("Resubmitted after changes");
  if (!resub && at > i.window_end_at) why.push("Submitted late");
  if (t.geofence && (loc.ok === false || loc.source === "simulated")) why.push("Location not confirmed");
  const miss = await missingEvidence(sid, t.id);
  if (miss.length) why.push("Missing evidence");
  const counts = await all<{ count_of: string | null; value: string | null }>(
    "SELECT it.count_of, a.value FROM answers a JOIN template_items it ON it.id=a.item_id WHERE a.submission_id=? AND it.kind='count'", sid);
  if (counts.length) {
    const ideal = await one<{ ideal_hk: number; ideal_shk: number }>("SELECT ideal_hk, ideal_shk FROM staffing WHERE property_id=?", i.property_id);
    if (ideal && counts.some((x) => x.value !== null && x.value !== "" && Number(x.value) < ((x.count_of ?? "HK") === "SHK" ? ideal.ideal_shk : ideal.ideal_hk))) why.push("Count below ideal");
  }
  // A fixed draw per submission, so the pick can't be changed by reloading and isn't predictable from the task.
  if (!why.length && hash(sid * 7919 + i.id) < c.sample) why.push("Random check");
  return why.length ? { wk: "must", why: why.join(", ") } : { wk: "auto", why: "Not picked" };
}
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
  x = (x ^ (x >>> 16)) >>> 0; // keep it unsigned: a negative draw would always be "picked", even at 0%
  return (x % 1000) / 1000;
}

async function pickAssignee(t: Template, propertyId: number): Promise<number | null> {
  const named = list(t.assignees);
  if (named.length) {
    const u = await one<{ user_id: number }>(`SELECT user_id FROM user_properties WHERE property_id=? AND user_id IN (${named.map(() => "?").join(",")}) ORDER BY user_id LIMIT 1`, propertyId, ...named);
    if (u) return u.user_id;
  }
  if (t.op_role === "CBM") return (await one<{ cbm_id: number }>("SELECT cbm_id FROM properties WHERE id=?", propertyId))?.cbm_id ?? null;
  const u = await one<{ id: number }>(
    `SELECT u.id FROM users u JOIN user_properties up ON up.user_id=u.id
     WHERE up.property_id=? AND u.op_role=? ORDER BY u.id LIMIT 1`, propertyId, t.op_role);
  return u?.id ?? null;
}

export function appliesOn(t: Template, date: string) {
  if (t.trigger !== "scheduled") return false;
  if (t.frequency === "daily") return true;
  if (t.frequency === "once") return date === t.once_date;
  const days = list(t.days);
  if (t.frequency === "weekly") return days.length ? days.includes(weekday(date)) : weekday(date) === (t.weekday ?? 1);
  if (t.frequency === "monthly") return (days.length ? days : [1]).includes(Number(date.slice(8, 10)));
  return false;
}

/** A cluster's reviewer and auditor take tasks that don't name their own. */
async function clusterDefault(propertyId: number) {
  return (await one<{ reviewer_id: number | null; auditor_id: number | null }>(
    "SELECT c.reviewer_id, c.auditor_id FROM properties p JOIN clusters c ON c.id=p.cluster_id WHERE p.id=?", propertyId)) ?? { reviewer_id: null, auditor_id: null };
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
  const def = t.reviewer_id && t.auditor_id ? null : await clusterDefault(propertyId);
  const res = await run(
    `INSERT OR IGNORE INTO instances (template_id, property_id, task_date, window_start_at, window_end_at, late_until_at,
      assignee_id, reviewer_id, auditor_id, status, status_since, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    t.id, propertyId, date, start, end, lateUntil, assignee !== undefined ? assignee : await pickAssignee(t, propertyId),
    t.reviewer_id ?? def?.reviewer_id ?? null, t.auditor_id ?? def?.auditor_id ?? null,
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
  const who = (t: Template, p: number) => {
    const named = list(t.assignees);
    const n = named.length ? staff.find((s) => s.property_id === p && named.includes(s.id)) : undefined;
    return n ? n.id : t.op_role === "CBM" ? cbm.get(p) ?? null : staff.find((s) => s.property_id === p && s.op_role === t.op_role)?.id ?? null;
  };
  await tx(async () => { for (const [t, p, d] of todo) await createInstance(t, p, d, "schedule", now, who(t, p)); });
}

export async function triggerEvent(templateId: number, propertyId: number, actorId: number, now: number) {
  const t = (await one<Template>("SELECT * FROM templates WHERE id=?", templateId))!;
  const id = await createInstance(t, propertyId, isoDate(now), `${t.trigger}:${now}`, now);
  if (id) await logEvent(id, now, actorId, "triggered", list<string>(t.events).join(", ") || t.event_name || "On demand");
  if (id) await coverAway(now);
  return id;
}

/** Moves instances along time-based transitions. Safe to call on every request: when nothing is due it is one read. */
/** People's own week offs, leave and backups (cached for a short while, like the team's week offs). */
export async function loadAway(force = false): Promise<Map<number, PersonOff>> {
  if (!force && awayCacheFresh()) return awayMap();
  const since = addDays(isoDate(Date.now()), -120);
  const users = await all<{ id: number; week_off: string | null; backup_id: number | null }>(
    `SELECT u.id, u.week_off, (SELECT b.id FROM users b WHERE b.id=u.backup_id AND b.archived=0) backup_id FROM users u
     WHERE u.archived=0 AND ((u.week_off IS NOT NULL AND u.week_off<>'[]') OR u.backup_id IS NOT NULL OR u.id IN (SELECT user_id FROM leaves WHERE to_date>=?))`, since);
  const leaves = await all<{ user_id: number; from_date: string; to_date: string; note: string | null }>(
    "SELECT user_id, from_date, to_date, note FROM leaves WHERE to_date>=? ORDER BY from_date", since);
  const m = new Map<number, PersonOff>();
  for (const u of users) m.set(u.id, { week: list<number>(u.week_off).filter((d) => d >= 0 && d <= 6), leaves: [], backup: u.backup_id });
  for (const l of leaves) m.get(l.user_id)?.leaves.push({ from: l.from_date, to: l.to_date, note: l.note });
  setAwayCache(m);
  return m;
}

/** Moves work away from people who are off. Tasks to do on someone's day off go to their backup or a teammate with the same role
 *  at that property; with nobody to cover, they're waived (not counted against anyone). Reviews and audits waiting for someone
 *  who's off today go to their backup; with no backup, the clock for those tasks pauses until they're back. Returns how many moved. */
export async function coverAway(now: number, force = false): Promise<number> {
  const m = await loadAway(force);
  const offIds = [...m].filter(([, p]) => p.week.length || p.leaves.length).map(([id]) => id);
  if (!offIds.length) return 0;
  const today = isoDate(now), IN = `(${offIds.join(",")})`;
  const todo = await all<{ id: number; status: string; task_date: string; property_id: number; op_role: string; assignee_id: number | null; reviewer_id: number | null; auditor_id: number | null; last_rev: number | null }>(
    `SELECT i.id, i.status, i.task_date, i.property_id, t.op_role, i.assignee_id, i.reviewer_id, i.auditor_id,
       (SELECT r.reviewer_id FROM reviews r WHERE r.instance_id=i.id AND r.kind='review' ORDER BY r.id DESC LIMIT 1) last_rev
     FROM instances i JOIN templates t ON t.id=i.template_id
     WHERE (i.status IN ('upcoming','current','notsub') AND i.task_date>=? AND i.assignee_id IN ${IN})
        OR (i.status IN ('review','resub') AND i.reviewer_id IN ${IN}) OR (i.status IN ('audit','flagans') AND i.auditor_id IN ${IN})`, addDays(today, -7));
  if (!todo.length) return 0;
  const people = new Map((await all<{ id: number; name: string; access_role: string; op_role: string | null }>(
    "SELECT id, name, access_role, op_role FROM users WHERE archived=0")).map((u) => [u.id, u]));
  const props = await all<{ user_id: number; property_id: number }>(
    "SELECT user_id, property_id FROM user_properties UNION SELECT cbm_id, id FROM properties WHERE cbm_id IS NOT NULL");
  const at = new Map<number, Set<number>>();
  for (const x of props) at.set(x.user_id, (at.get(x.user_id) ?? new Set()).add(x.property_id));
  const name = (id: number) => people.get(id)?.name ?? "someone";
  let n = 0;
  await tx(async () => {
    for (const i of todo) {
      if (i.status === "upcoming" || i.status === "current" || i.status === "notsub") {
        const why = personOffWhy(m.get(i.assignee_id!), i.task_date);
        if (!why) continue;
        const role = people.get(i.assignee_id!)?.access_role;
        const works = (id: number) => people.get(id)?.access_role === role && !!at.get(id)?.has(i.property_id);
        const mates = [...people.values()].filter((u) => u.op_role === i.op_role && works(u.id)).map((u) => u.id);
        const cover = coverFor(m, i.assignee_id!, i.task_date, mates, works);
        if (cover) {
          await run("UPDATE instances SET assignee_id=? WHERE id=?", cover, i.id);
          await logEvent(i.id, now, null, "reassigned", `${name(cover)} covering for ${name(i.assignee_id!)} (${why.toLowerCase()})`);
          if (i.task_date <= today) await notify(cover, { kind: "assigned", title: await taskTitle(i.id), body: `You're covering for ${name(i.assignee_id!)} (${why.toLowerCase()})`, link: `/tasks/${i.id}`, instanceId: i.id }, now);
        } else {
          await setStatus(i.id, "waived", now, ", closed_at=?", now);
          await logEvent(i.id, now, null, "waived", `Not counted: ${name(i.assignee_id!)} was off (${why.toLowerCase()}) and nobody could cover`);
        }
        n++;
        continue;
      }
      const review = i.status === "review" || i.status === "resub";
      const who = review ? i.reviewer_id! : i.auditor_id!;
      const why = personOffWhy(m.get(who), today);
      if (!why) continue;
      const role = people.get(who)?.access_role;
      const cover = coverFor(m, who, today, [], (id) => people.get(id)?.access_role === role, review ? [i.auditor_id] : [i.reviewer_id, i.last_rev]);
      if (!cover) continue; // Nobody to cover: the clock pauses on their days off (see waitMs).
      await run(`UPDATE instances SET ${review ? "reviewer_id" : "auditor_id"}=? WHERE id=?`, cover, i.id);
      await logEvent(i.id, now, null, "reassigned", `${review ? "Review" : "Audit"} moved to ${name(cover)}: ${name(who)} is off (${why.toLowerCase()})`);
      await notify(cover, { kind: "assigned", title: await taskTitle(i.id), body: `${review ? "Review" : "Audit"} moved to you: ${name(who)} is off (${why.toLowerCase()})`, link: `/review/${i.id}`, instanceId: i.id }, now);
      n++;
    }
  });
  return n;
}

export async function sweep(now = Date.now()) {
  await dropOrphans();
  await generateInstances(isoDate(now), addDays(isoDate(now), 1), now);
  await coverAway(now);
  const c = await loadOff();
  const due = await one<{ n: number; wk: number }>(`SELECT count(*) FILTER (WHERE (status='upcoming' AND window_start_at<=?)
    OR (status='current' AND window_end_at<=?) OR (status='notsub' AND late_until_at<=?)) n,
    count(*) FILTER (WHERE wk='auto' AND status IN ('review','resub') AND last_submitted_at<=?) wk FROM instances`, now, now, now, now - c.closeAfterH * HOUR);
  if (due?.wk) await autoCloseWeekend(now);
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

export type Loc = { ok: boolean | null; distance: number | null; source?: "gps" | "approx" | "simulated" | null; accuracy?: number | null };
export async function submit(instanceId: number, userId: number, answers: AnswerInput[], loc: Loc, at: number) {
  return await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    const t = (await one<Template>("SELECT * FROM templates WHERE id=?", i.template_id))!;
    if (!["current", "notsub", "changes"].includes(i.status)) throw new Error("This task can't be submitted right now.");
    const resub = i.status === "changes";
    const attempt = i.attempt + 1;
    const s = await run("INSERT INTO submissions (instance_id, attempt, submitted_by, submitted_at, location_ok, distance_m, location_src, accuracy_m) VALUES (?,?,?,?,?,?,?,?)",
      instanceId, attempt, userId, at, loc.ok === null ? null : loc.ok ? 1 : 0, loc.distance, loc.source ?? (loc.ok === null ? null : "gps"), loc.accuracy ?? null);
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
      // Tasks without review are done once submitted.
      const next = t.review_required === 0 ? "done" : "review";
      await setStatus(instanceId, next, at, `, attempt=?, first_submitted_at=?, last_submitted_at=?${next === "done" ? ", closed_at=?" : ""}`, attempt, at, at, ...(next === "done" ? [at] : []));
      await logEvent(instanceId, at, userId, "submitted", (late ? "Submitted late" : "Submitted on time") + (next === "done" ? " · no review needed" : ""));
    }
    // Off-day submissions go to the reviewers' Weekend list (working-day ones clear any earlier mark).
    const toReview = resub || t.review_required !== 0;
    const c = await loadOff();
    const pick = toReview && isOff(c, isoDate(at)) ? await weekendPick(c, i, t, sid, at, loc, resub) : null;
    await run("UPDATE instances SET wk=?, wk_why=? WHERE id=?", pick?.wk ?? null, pick?.why ?? null, instanceId);
    if (t.geofence && loc.ok === false) await logEvent(instanceId, at, userId, "location_warning", `Submitted ${loc.distance == null ? "?" : loc.distance >= 1000 ? `${(loc.distance / 1000).toFixed(1)} km` : `${loc.distance} m`} from property`);
    if (t.geofence && loc.source === "simulated") await logEvent(instanceId, at, userId, "location_warning", "Location simulated, not checked");
    if (t.geofence && loc.source === "approx") await logEvent(instanceId, at, userId, "location_warning", `Location not verified: the device gave only a rough area (±${Math.round((loc.accuracy ?? 0) / 1000)} km)`);
    return sid;
  });
}

export async function latestSubmission(instanceId: number) {
  return await one<{ id: number; attempt: number; submitted_at: number; submitted_by: number; location_ok: number | null; distance_m: number | null; location_src: string | null; accuracy_m: number | null }>(
    "SELECT * FROM submissions WHERE instance_id=? ORDER BY attempt DESC LIMIT 1", instanceId);
}

async function pickAuditor(i: Instance, reviewerId: number | null, at: number) {
  const sub = await latestSubmission(i.id);
  const bad = new Set([reviewerId, sub?.submitted_by, i.assignee_id]);
  if (i.auditor_id && !bad.has(i.auditor_id)) return i.auditor_id;
  const auditors = await all<{ id: number }>("SELECT id FROM users WHERE access_role='auditor' AND archived=0 ORDER BY id");
  return auditors.find((a) => !bad.has(a.id))?.id ?? auditors[0]?.id ?? null;
}

/** A pass: the audit sample sends some to an auditor, the rest are done. */
async function pass(i: Instance, t: Template, reviewerId: number | null, at: number, note = "") {
  if (hash(i.id) < t.audit_rate) {
    const aud = await pickAuditor(i, reviewerId, at);
    await setStatus(i.id, "audit", at, ", auditor_id=?", aud);
    await logEvent(i.id, at, reviewerId, "passed", "Selected for audit" + note);
  } else {
    await setStatus(i.id, "done", at, ", closed_at=?", at);
    await logEvent(i.id, at, reviewerId, "passed", "Verified" + note);
  }
}

/** Off-day tasks nobody picked close by themselves once the team has been back for the set hours. They pass the same
 *  way a reviewed task does (the audit sample still applies); the internal note says it wasn't checked by hand. */
export async function autoCloseWeekend(now: number) {
  const c = await loadOff();
  const due = await all<Instance>(`SELECT * FROM instances WHERE wk='auto' AND status IN ('review','resub') AND last_submitted_at<=?`, now - c.closeAfterH * HOUR);
  const ready = due.filter((i) => autoCloseAt(c, i.last_submitted_at ?? i.status_since) <= now);
  if (!ready.length) return 0;
  await tx(async () => {
    for (const r of ready) {
      const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", r.id))!;
      if (i.wk !== "auto" || !["review", "resub"].includes(i.status)) continue;
      const t = (await one<Template>("SELECT * FROM templates WHERE id=?", i.template_id))!;
      const at = autoCloseAt(c, i.last_submitted_at ?? i.status_since);
      if (!i.first_decision) await run("UPDATE instances SET first_decision='pass' WHERE id=?", i.id);
      await pass(i, t, null, at);
      await run("UPDATE instances SET wk_closed_at=? WHERE id=?", at, i.id);
      await logEvent(i.id, at, null, "weekend_closed", "Closed by weekend sampling, not checked by hand");
    }
  });
  return ready.length;
}

/** A reviewer takes an auto-closed off-day task back into review, within the pull-back window. */
export async function pullBack(instanceId: number, actorId: number, at: number) {
  const c = await loadOff();
  await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    if (!i.wk_closed_at || i.status !== "done") throw new Error("Only tasks closed by weekend sampling can be pulled back.");
    if (at - i.wk_closed_at > c.pullbackDays * DAY) throw new Error(`Tasks can be pulled back for ${c.pullbackDays} days after closing.`);
    await setStatus(instanceId, i.attempt > 1 ? "resub" : "review", at, ", closed_at=NULL, wk='must', wk_why='Pulled back', wk_closed_at=NULL");
    await logEvent(instanceId, at, actorId, "reopened", "Back to review");
  });
}

export async function reviewDecision(instanceId: number, reviewerId: number, decision: "pass" | "changes", flags: FlagInput[], comment: string, at: number, openedAt?: number) {
  return await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    const t = (await one<Template>("SELECT * FROM templates WHERE id=?", i.template_id))!;
    if (!["review", "resub"].includes(i.status)) throw new Error("This task is not waiting for review.");
    const sub = (await latestSubmission(instanceId))!;
    if (sub.submitted_by === reviewerId) throw new Error("You submitted this task, so someone else must review it.");
    // A reviewer may pass items that are missing evidence (their call); the history records which ones.
    const accepted = decision === "pass" ? (await missingEvidence(sub.id, t.id)).map((m) => m.label) : [];
    if (decision === "changes" && !flags.length) throw new Error("Flag at least one item, with a reason, to request changes.");
    const r = await run("INSERT INTO reviews (instance_id, submission_id, reviewer_id, kind, decision, opened_at, decided_at, due_at, comment) VALUES (?,?,?,?,?,?,?,?,?)",
      instanceId, sub.id, reviewerId, "review", decision, openedAt ?? null, at, addWork(forPerson(await loadOff(), reviewerId), i.last_submitted_at ?? at, t.review_sla_h * HOUR), comment || null);
    const rid = Number(r.lastInsertRowid);
    for (const f of flags) await run("INSERT INTO review_flags (review_id, item_id, reason, comment) VALUES (?,?,?,?)", rid, f.itemId, f.reason, f.comment ?? null);
    if (!i.first_decision) await run("UPDATE instances SET first_decision=? WHERE id=?", decision, instanceId);
    await run("UPDATE instances SET reviewer_id=? WHERE id=?", reviewerId, instanceId);
    if (decision === "changes") {
      const exhausted = i.attempt >= t.attempts_allowed;
      await setStatus(instanceId, exhausted ? "notrect" : "changes", at, exhausted ? ", closed_at=?" : "", ...(exhausted ? [at] : []));
      await logEvent(instanceId, at, reviewerId, "changes_requested", flags.map((f) => f.reason).join(", ") + (exhausted ? " · attempts used up, not rectified" : ""));
      if (!exhausted) await notify(i.assignee_id, { kind: "changes", title: await taskTitle(instanceId), body: `Changes required: ${flags.map((f) => f.reason).join(", ")}`, link: `/tasks/${instanceId}`, instanceId, actorId: reviewerId }, at);
    } else {
      const noEvidence = accepted.length ? ` · accepted without evidence: ${accepted.join("; ")}` : "";
      await pass(i, t, reviewerId, at, noEvidence);
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
      instanceId, sub.id, auditorId, "audit", decision, at, addWork(forPerson(await loadOff(), auditorId), i.status_since, t.audit_sla_h * HOUR), comment || null);
    const rid = Number(r.lastInsertRowid);
    for (const f of flags) await run("INSERT INTO review_flags (review_id, item_id, reason, comment) VALUES (?,?,?,?)", rid, f.itemId, f.reason, f.comment ?? null);
    if (decision === "pass") {
      await setStatus(instanceId, "done", at, ", closed_at=?", at);
      await logEvent(instanceId, at, auditorId, "audit_passed", "Closed");
    } else {
      await setStatus(instanceId, "auditflag", at);
      await logEvent(instanceId, at, auditorId, "audit_failed", flags.map((f) => f.reason).join(", ") + " · CBM to answer");
      const cbm = await one<{ cbm_id: number | null }>("SELECT cbm_id FROM properties WHERE id=?", i.property_id);
      await notify(cbm?.cbm_id, { kind: "auditflag", title: await taskTitle(instanceId), body: `Audit flags to answer: ${flags.map((f) => f.reason).join(", ")}`, link: `/tasks/${instanceId}`, instanceId, actorId: auditorId }, at);
    }
  });
}

export async function answerAuditFlags(instanceId: number, userId: number, answers: Record<number, string>, at: number) {
  await tx(async () => {
    const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
    if (i.status !== "auditflag") throw new Error("No open audit flags on this task.");
    // Only the flags of this task's latest audit can be answered, and every one of them must be.
    const audit = await one<{ id: number }>("SELECT id FROM reviews WHERE instance_id=? AND kind='audit' ORDER BY decided_at DESC, id DESC LIMIT 1", instanceId);
    const open = audit ? await all<{ id: number }>("SELECT id FROM review_flags WHERE review_id=?", audit.id) : [];
    const ids = new Set(open.map((f) => f.id));
    for (const fid of Object.keys(answers)) if (!ids.has(Number(fid))) throw new Error("That answer is for a flag that isn't on this task.");
    if (!open.length || open.some((f) => !answers[f.id]?.trim())) throw new Error("Answer every flag before sending.");
    for (const f of open) await run("UPDATE review_flags SET answer=?, answered_at=? WHERE id=?", answers[f.id].trim(), at, f.id);
    await setStatus(instanceId, "flagans", at);
    await logEvent(instanceId, at, userId, "flags_answered", `${open.length} flag(s) answered`);
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
  await setStatus(instanceId, "review", at, ", closed_at=NULL, wk=NULL, wk_why=NULL, wk_closed_at=NULL");
  await logEvent(instanceId, at, actorId, "reopened", "Back to review");
}

export async function waive(instanceId: number, actorId: number, reason: string, at: number) {
  const i = (await one<Instance>("SELECT * FROM instances WHERE id=?", instanceId))!;
  if (!["upcoming", "current", "notsub"].includes(i.status)) throw new Error("Only open, unsubmitted tasks can be waived.");
  await setStatus(instanceId, "waived", at, ", closed_at=?", at);
  await logEvent(instanceId, at, actorId, "waived", reason);
}

export async function reassignReviewer(instanceId: number, reviewerId: number, actorId: number, at: number) {
  const sub = await latestSubmission(instanceId);
  if (sub && sub.submitted_by === reviewerId) throw new Error("That person submitted the task, so they can't review it.");
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

export async function remind(instanceIds: number[], actorId: number, at: number, doersOnly = false) {
  const people = new Set<number>();
  let skipped = 0, self = 0, peers = 0;
  await tx(async () => {
    for (const id of instanceIds) {
      // Don't nag: skip a task that already got a reminder in the last 4 hours.
      if (await one("SELECT 1 FROM events WHERE instance_id=? AND type='reminder' AND at>?", id, at - 4 * HOUR)) { skipped++; continue; }
      const i = await one<Instance & { cbm_id: number | null }>(
        "SELECT i.*, p.cbm_id FROM instances i JOIN properties p ON p.id=i.property_id WHERE i.id=?", id);
      if (!i) continue;
      const who = nextActor(i, i.cbm_id);
      if (!who) continue;
      if (who === actorId) { self++; continue; }
      if (doersOnly && !["upcoming", "current", "notsub", "changes", "auditflag"].includes(i.status)) { peers++; continue; }
      people.add(who);
      const u = await one<{ name: string; access_role: string }>("SELECT name, access_role FROM users WHERE id=?", who);
      await logEvent(id, at, actorId, "reminder", `Reminder sent to ${u?.name}`);
      const doer = ["upcoming", "current", "notsub", "changes", "auditflag"].includes(i.status);
      const what = { current: "Please submit it before the window closes.", upcoming: "It opens soon.", notsub: "It's overdue. Please submit it now.", changes: "Changes are waiting. Please fix and resubmit.",
        auditflag: "Audit flags are waiting for your answer.", review: "It's waiting for your review.", resub: "A resubmission is waiting for your review.", audit: "It's waiting for your audit.", flagans: "Flag answers are waiting for you to close." }[i.status] ?? "";
      await notify(who, { kind: "reminder", title: await taskTitle(id), body: what, link: doer && u?.access_role !== "admin" ? `/tasks/${id}` : `/review/${id}`, instanceId: id, actorId }, at);
    }
  });
  return { people: people.size, skipped, self, peers };
}

// A scheduled run nobody has submitted yet: still open (or not yet open) and never sent in.
const UNSENT = "source='schedule' AND attempt=0 AND first_submitted_at IS NULL AND status IN ('upcoming','current','notsub')";

async function dropRuns(ids: number[]) {
  if (!ids.length) return 0;
  const iq = ids.join(",");
  await batch([[`DELETE FROM events WHERE instance_id IN (${iq})`], [`DELETE FROM instances WHERE id IN (${iq})`]]);
  return ids.length;
}

/** Removes runs of a task at properties it no longer covers, as long as nobody has submitted them (with their history). */
export async function dropUpcoming(templateId: number, propertyIds: number[]) {
  if (!propertyIds.length) return 0;
  const q = propertyIds.map(() => "?").join(",");
  return dropRuns((await all<{ id: number }>(`SELECT id FROM instances WHERE template_id=? AND ${UNSENT} AND property_id IN (${q})`, templateId, ...propertyIds)).map((x) => x.id));
}

/** Clears unsent runs left at properties a task was taken off before this rule existed, so they stop counting as to-do and overdue. */
export async function dropOrphans() {
  return dropRuns((await all<{ id: number }>(`SELECT i.id FROM instances i WHERE ${UNSENT.replace(/(source|attempt|first_submitted_at|status)/g, "i.$1")}
    AND NOT EXISTS (SELECT 1 FROM template_properties tp WHERE tp.template_id=i.template_id AND tp.property_id=i.property_id)`)).map((x) => x.id));
}
