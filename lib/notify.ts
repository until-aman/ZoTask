// The bell: reminders and other things that need a person's attention, one row per recipient.
import { all, one, run } from "./db";

export type NoteKind = "reminder" | "changes" | "auditflag" | "escalation" | "assigned";
export type Note = { id: number; at: number; kind: NoteKind; title: string; body: string | null; link: string | null; actor: string | null; read: boolean };

/** Adds a notification for one person. Never for yourself. */
export async function notify(userId: number | null | undefined, x: { kind: NoteKind; title: string; body?: string | null; link?: string | null; instanceId?: number | null; actorId?: number | null }, at: number) {
  if (!userId || userId === x.actorId) return;
  await run("INSERT INTO notifications (user_id, at, kind, title, body, link, instance_id, actor_id) VALUES (?,?,?,?,?,?,?,?)",
    userId, at, x.kind, x.title, x.body ?? null, x.link ?? null, x.instanceId ?? null, x.actorId ?? null);
}

/** "Task name · Property" for a task, used in notification titles. */
export async function taskTitle(instanceId: number) {
  const r = await one<{ task: string; property: string }>("SELECT t.name task, p.name property FROM instances i JOIN templates t ON t.id=i.template_id JOIN properties p ON p.id=i.property_id WHERE i.id=?", instanceId);
  return r ? `${r.task} · ${r.property}` : `Task #${instanceId}`;
}

/** The newest 40 notifications, the unread count, and the unread ones not yet shown as a pop-up (which are then marked as shown). */
export async function inbox(userId: number, now: number) {
  const rows = await all<{ id: number; at: number; kind: NoteKind; title: string; body: string | null; link: string | null; actor: string | null; read_at: number | null; popped_at: number | null }>(
    `SELECT n.*, u.name actor FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=? ORDER BY n.id DESC LIMIT 40`, userId);
  const unread = (await one<{ n: number }>("SELECT count(*) n FROM notifications WHERE user_id=? AND read_at IS NULL", userId))?.n ?? 0;
  // Pop up only what arrived in the last day, so someone back from leave doesn't get a wall of pop-ups.
  const pop = rows.filter((r) => !r.read_at && !r.popped_at && r.at > now - 864e5).slice(0, 3);
  if (rows.some((r) => !r.popped_at)) await run("UPDATE notifications SET popped_at=? WHERE user_id=? AND popped_at IS NULL", now, userId);
  const out = (r: (typeof rows)[number]): Note => ({ id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body, link: r.link, actor: r.actor, read: !!r.read_at });
  return { unread, items: rows.map(out), pop: pop.map(out), latest: rows[0]?.id ?? 0 };
}

/** Marks some (or all) of a person's notifications as read. */
export async function markRead(userId: number, ids: number[] | "all", now: number) {
  if (ids === "all") await run("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL", now, userId);
  else if (ids.length) await run(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`, now, userId, ...ids.map(Number));
}
