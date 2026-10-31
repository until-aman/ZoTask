import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { all } from "@/lib/db";
import { geo } from "@/lib/queries";
import TriggerForm from "@/components/TriggerForm";
import AdminClient, { Tpl } from "@/components/admin/AdminClient";
import { Category, Checklist, Cluster, Count, Schedule } from "@/components/admin/Libraries";
import { viewsFor } from "@/lib/views";

export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await boot();
  if (!can.admin(u)) redirect("/");
  const tab = (await searchParams).tab ?? "tasks";
  const templates = await all<Tpl>(
    `SELECT t.*, (SELECT count(*) FROM template_properties tp WHERE tp.template_id=t.id) props, r.name reviewer, a.name auditor
     FROM templates t LEFT JOIN users r ON r.id=t.reviewer_id LEFT JOIN users a ON a.id=t.auditor_id ORDER BY t.id`);
  const props = await all<{ id: number; name: string; cluster: string; city: string; cbm: string | null; staff: number; city_id: number; cluster_id: number }>(
    `SELECT p.id, p.name, cl.name cluster, c.name city, u.name cbm, c.id city_id, cl.id cluster_id,
      (SELECT count(*) FROM user_properties up JOIN users x ON x.id=up.user_id WHERE up.property_id=p.id AND x.access_role='ground') staff
     FROM properties p JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id LEFT JOIN users u ON u.id=p.cbm_id ORDER BY c.name, cl.name, p.name`);
  const people = await all<{ access_role: string; n: number }>("SELECT access_role, count(*) n FROM users GROUP BY access_role");
  const staff = await all<{ id: number; name: string; access_role: string }>("SELECT id, name, access_role FROM users WHERE access_role IN ('reviewer','auditor') ORDER BY name");
  const lib = {
    checklists: await all<Checklist>("SELECT * FROM checklist_presets ORDER BY title"),
    schedules: await all<Schedule>("SELECT * FROM schedule_presets ORDER BY name"),
    categories: await all<Category>("SELECT c.id, c.name, c.archived, (SELECT count(*) FROM templates t WHERE t.category=c.name) used FROM task_categories c ORDER BY c.archived, c.pos, c.id"),
    counts: await all<Count>(
      `SELECT p.id property_id, 'ZO' || substr('0000' || p.id, -4) zolo, c.name city, p.name, s.ideal_hk, s.ideal_shk, s.current_hk, s.current_shk
       FROM properties p JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id LEFT JOIN staffing s ON s.property_id=p.id ORDER BY c.name, p.name`),
    clusters: await all<Cluster>(
      `SELECT cl.id, cl.name, cl.city_id, c.name city, cl.reviewer_id, cl.auditor_id, cl.archived,
        (SELECT group_concat(p.name, ', ') FROM properties p WHERE p.cluster_id=cl.id) props, (SELECT count(*) FROM properties p WHERE p.cluster_id=cl.id) n
       FROM clusters cl JOIN cities c ON c.id=cl.city_id ORDER BY c.name, cl.name`),
    cities: await all<{ id: number; name: string }>("SELECT id, name FROM cities ORDER BY name"),
    reviewers: staff.filter((x) => x.access_role === "reviewer"), auditors: staff.filter((x) => x.access_role === "auditor"),
  };
  return (
    <AdminClient tab={tab} templates={templates} props={props} people={people} views={await viewsFor(u.id, "admin")} lib={lib}>
      <TriggerForm templates={templates.filter((t) => t.trigger !== "scheduled" && t.active).map((t) => ({ id: t.id, name: t.name, label: JSON.parse(t.events || "[]")[0] ?? t.event_name ?? "On demand" }))}
        properties={(await geo()).map((g) => ({ id: g.id, name: `${g.property} · ${g.city}` }))} />
    </AdminClient>
  );
}
