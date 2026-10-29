// Everything about one task, for the dashboard's side drawer.
import { all } from "./db";
import { User } from "./auth";
import { itemsFor, missingEvidence } from "./engine";
import { rows, eventsFor } from "./queries";

export async function taskDetail(id: number, u: User) {
  const [r] = await rows("i.id=?", id);
  if (!r) return null;
  const items = await itemsFor(r.template_id);
  const subs = await all<{ id: number; attempt: number; submitted_at: number; location_ok: number | null; distance_m: number | null; by_name: string }>(
    "SELECT s.*, u.name AS by_name FROM submissions s JOIN users u ON u.id=s.submitted_by WHERE instance_id=? ORDER BY attempt", id);
  const answers = await all<{ submission_id: number; item_id: number; checked: number; value: string | null; note: string | null; photos: string; reply: string | null }>(
    "SELECT a.* FROM answers a JOIN submissions s ON s.id=a.submission_id WHERE s.instance_id=?", id);
  const reviews = await all<{ id: number; kind: string; decision: string; decided_at: number; due_at: number | null; reviewer: string; comment: string | null; submission_id: number }>(
    "SELECT r.*, u.name reviewer FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE instance_id=? ORDER BY decided_at", id);
  const flags = await all<{ id: number; review_id: number; item_id: number; reason: string; comment: string | null; answer: string | null }>(
    "SELECT f.* FROM review_flags f JOIN reviews r ON r.id=f.review_id WHERE r.instance_id=?", id);
  const latest = subs[subs.length - 1];
  const pack = (sid?: number) => Object.fromEntries(answers.filter((a) => a.submission_id === sid).map((a) => [a.item_id, { ...a, photos: JSON.parse(a.photos) as string[] }]));
  const mode =
    ["review", "resub"].includes(r.status) && ["reviewer", "admin"].includes(u.access_role) ? "review" :
    r.status === "audit" && ["auditor", "admin"].includes(u.access_role) ? "audit" : "view";
  const lastAudit = [...reviews].reverse().find((x) => x.kind === "audit");
  return {
    r, items, mode, subs: subs.map((s) => ({ ...s, answers: pack(s.id) })),
    reviews: reviews.map((x) => ({ ...x, flags: flags.filter((f) => f.review_id === x.id).map((f) => ({ ...f, item: items.find((i) => i.id === f.item_id)?.label ?? "Item" })) })),
    events: await eventsFor(id),
    form: latest ? {
      latest: pack(latest.id), previous: subs.length > 1 ? pack(subs[subs.length - 2].id) : null,
      prevFlags: flags.filter((f) => reviews.find((x) => x.id === f.review_id)?.submission_id === subs[subs.length - 2]?.id),
      auditFlags: lastAudit ? flags.filter((f) => f.review_id === lastAudit.id) : [], missing: (await missingEvidence(latest.id, r.template_id)).map((m) => m.id),
    } : null,
  };
}
export type Detail = NonNullable<Awaited<ReturnType<typeof taskDetail>>>;
