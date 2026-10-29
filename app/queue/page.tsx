import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can, scopeProps } from "@/lib/auth";
import { all } from "@/lib/db";
import { nextActor } from "@/lib/engine";
import { rows, geo } from "@/lib/queries";
import { HOUR, isoDate } from "@/lib/time";
import QueueClient, { QItem } from "@/components/QueueClient";

// Hours the next actor has before a state counts as over SLA (0 = no SLA, shown against the window instead).
const FIX_SLA_H = 24, ANSWER_SLA_H = 48;

export default async function Queue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await boot();
  if (!can.queue(u)) redirect("/tasks");
  const sp = await searchParams;
  const props = await scopeProps(u);
  const now = Date.now();
  const names = new Map((await all<{ id: number; name: string }>("SELECT id, name FROM users")).map((x) => [x.id, x.name]));
  const list = await rows(`i.status NOT IN ('upcoming','current') AND i.property_id IN (${props.join(",") || 0})`);
  const items: QItem[] = list.map((r) => {
    const sla = ["review", "resub"].includes(r.status) ? r.review_sla_h : ["audit", "flagans"].includes(r.status) ? r.audit_sla_h
      : r.status === "changes" ? FIX_SLA_H : r.status === "auditflag" ? ANSWER_SLA_H : 0;
    const next = nextActor(r, r.cbm_id);
    return {
      id: r.id, t: r.task, p: r.property, cluster: r.cluster, city: r.city, a: r.assignee ?? "Unassigned", r: r.op_role, s: r.status,
      h: Math.max(0, Math.round((now - r.status_since) / HOUR)), sla, att: r.attempt ? `${r.attempt} of ${r.attempts_allowed}` : "",
      last: r.attempt >= r.attempts_allowed, rv: r.reviewer ?? "", au: r.auditor ?? "", cbm: r.cbm ?? "", date: r.task_date,
      why: r.last_reason ?? "", win: `${r.window_start}–${r.window_end}`, crit: r.criticality === "high",
      next: next ? names.get(next) ?? "" : "", mine: next === u.id,
    };
  });
  const views = (await all<{ id: number; name: string; filters: string; is_default: number }>("SELECT * FROM saved_views WHERE user_id=? ORDER BY id", u.id))
    .map((v) => ({ id: v.id, name: v.name, def: !!v.is_default, f: JSON.parse(v.filters) }));
  const reviewers = await all<{ id: number; name: string }>("SELECT id, name FROM users WHERE access_role='reviewer' ORDER BY name");
  const g = (await geo()).filter((x) => props.includes(x.id));
  const initial = {
    tab: sp.tab, city: sp.city?.split("|"), cluster: sp.cluster?.split("|"), prop: sp.prop?.split("|"),
    from: sp.from, to: sp.to, bucket: sp.bucket, over: sp.over === "1",
  };
  return <QueueClient items={items} geo={g} views={views} reviewers={reviewers} me={u.name}
    canReview={["reviewer", "admin"].includes(u.access_role)} today={isoDate(now)} initial={initial} />;
}
