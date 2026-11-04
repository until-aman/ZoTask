import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can, scopeProps } from "@/lib/auth";
import { all } from "@/lib/db";
import { loadOff, nextActor } from "@/lib/engine";
import { autoCloseAt, waitMs } from "@/lib/offdays";
import { rows, geo } from "@/lib/queries";
import { viewsFor } from "@/lib/views";
import { DAY, HOUR, isoDate } from "@/lib/time";
import { actionLabel } from "@/lib/statuses";
import QueueClient, { QItem } from "@/components/QueueClient";

// Hours the next actor has before a state counts as over SLA (0 = no SLA, shown against the window instead).
const FIX_SLA_H = 24, ANSWER_SLA_H = 48;

export default async function Queue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await boot();
  if (!can.queue(u)) redirect("/");
  const sp = await searchParams;
  const props = await scopeProps(u);
  const now = Date.now();
  const names = new Map((await all<{ id: number; name: string }>("SELECT id, name FROM users")).map((x) => [x.id, x.name]));
  // Week-off handling is the central team's business: CBMs get none of it, so their queue looks the same any day.
  const central = ["admin", "reviewer", "auditor"].includes(u.access_role);
  const off = await loadOff();
  const list = await rows(`i.status NOT IN ('upcoming','current') AND i.property_id IN (${props.join(",") || 0})`);
  const items: QItem[] = list.map((r) => {
    const sla = ["review", "resub"].includes(r.status) ? r.review_sla_h : ["audit", "flagans"].includes(r.status) ? r.audit_sla_h
      : r.status === "changes" ? FIX_SLA_H : r.status === "auditflag" ? ANSWER_SLA_H : 0;
    const next = nextActor(r, r.cbm_id);
    return {
      id: r.id, t: r.task, p: r.property, cluster: r.cluster, city: r.city, a: r.assignee ?? "Unassigned", r: r.op_role, s: r.status,
      h: Math.max(0, Math.round(waitMs(off, r, now) / HOUR)), sla, att: r.attempt ? `${r.attempt} of ${r.attempts_allowed}` : "",
      last: r.attempt >= r.attempts_allowed, rv: r.reviewer ?? "", au: r.auditor ?? "", cbm: r.cbm ?? "", date: r.task_date,
      why: r.last_reason ?? "", win: `${r.window_start}–${r.window_end}`, crit: r.criticality === "high",
      next: next ? names.get(next) ?? "" : "", mine: next === u.id,
      schedAt: r.window_start_at, lastL: actionLabel(r.last_type), lastAt: r.last_at ?? r.status_since,
      ...(central && r.wk && ["review", "resub"].includes(r.status) ? { wk: r.wk as "must" | "auto", wkWhy: r.wk_why ?? "", wkClose: autoCloseAt(off, r.last_submitted_at ?? r.status_since) } : {}),
      ...(central && r.wk_closed_at ? { wkClosedAt: r.wk_closed_at, pull: r.status === "done" && now - r.wk_closed_at <= off.pullbackDays * DAY } : {}),
    };
  });
  const views = await viewsFor(u.id, "queue");
  const reviewers = await all<{ id: number; name: string }>("SELECT id, name FROM users WHERE access_role='reviewer' AND archived=0 ORDER BY name");
  const g = (await geo()).filter((x) => props.includes(x.id));
  const initial = {
    tab: sp.tab, city: sp.city?.split("|"), cluster: sp.cluster?.split("|"), prop: sp.prop?.split("|"),
    from: sp.from, to: sp.to, bucket: sp.bucket, over: sp.over === "1",
  };
  return <QueueClient items={items} geo={g} views={views} reviewers={reviewers} me={u.name}
    canReview={["reviewer", "admin"].includes(u.access_role)} isAdmin={u.access_role === "admin"} canEscalate={central} isCentral={central} pullbackDays={off.pullbackDays} today={isoDate(now)} initial={initial} />;
}
