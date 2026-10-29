import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { all } from "@/lib/db";
import { geo } from "@/lib/queries";
import TriggerForm from "@/components/TriggerForm";
import AdminClient from "@/components/admin/AdminClient";
import { viewsFor } from "@/lib/views";

export default async function Admin() {
  const u = await boot();
  if (!can.admin(u)) redirect("/");
  const templates = await all<{ id: number; name: string; category: string; op_role: string; trigger: string; event_name: string | null; frequency: string; window_start: string; window_end: string; review_sla_h: number; audit_sla_h: number; attempts_allowed: number; criticality: string; audit_rate: number; active: number; props: number; reviewer: string | null; auditor: string | null }>(
    `SELECT t.*, (SELECT count(*) FROM template_properties tp WHERE tp.template_id=t.id) props, r.name reviewer, a.name auditor
     FROM templates t LEFT JOIN users r ON r.id=t.reviewer_id LEFT JOIN users a ON a.id=t.auditor_id ORDER BY t.id`);
  const props = await all<{ id: number; name: string; cluster: string; city: string; cbm: string | null; staff: number }>(
    `SELECT p.id, p.name, cl.name cluster, c.name city, u.name cbm,
      (SELECT count(*) FROM user_properties up JOIN users x ON x.id=up.user_id WHERE up.property_id=p.id AND x.access_role='ground') staff
     FROM properties p JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id LEFT JOIN users u ON u.id=p.cbm_id ORDER BY c.name, cl.name, p.name`);
  const people = await all<{ access_role: string; n: number }>("SELECT access_role, count(*) n FROM users GROUP BY access_role");
  return (
    <AdminClient templates={templates} props={props} people={people} views={await viewsFor(u.id, "admin")}>
      <TriggerForm templates={templates.filter((t) => t.trigger !== "scheduled" && t.active).map((t) => ({ id: t.id, name: t.name, label: t.event_name ?? "On demand" }))}
        properties={(await geo()).map((g) => ({ id: g.id, name: `${g.property} · ${g.city}` }))} />
    </AdminClient>
  );
}
