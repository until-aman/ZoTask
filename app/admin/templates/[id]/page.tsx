import Link from "next/link";
import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { Template, itemsFor } from "@/lib/engine";
import { geo } from "@/lib/queries";
import TemplateEditor, { ChecklistPreset, SchedulePreset } from "@/components/TemplateEditor";

export default async function EditTemplate({ params }: { params: Promise<{ id: string }> }) {
  const u = await boot();
  if (!can.admin(u)) redirect("/");
  const raw = (await params).id;
  const id = raw === "new" ? null : Number(raw);
  const t = id ? await one<Template>("SELECT * FROM templates WHERE id=?", id) : undefined;
  if (id && !t) redirect("/admin");
  const items = id ? (await itemsFor(id)).filter((i) => i.pos < 1000) : [];
  const selected = id ? (await all<{ property_id: number }>("SELECT property_id FROM template_properties WHERE template_id=?", id)).map((x) => x.property_id) : [];
  const people = await all<{ id: number; name: string; access_role: string; op_role: string | null; props: string | null }>(
    `SELECT u.id, u.name, u.access_role, u.op_role,
      (SELECT group_concat(p.name, ', ') FROM user_properties up JOIN properties p ON p.id=up.property_id WHERE up.user_id=u.id) props
     FROM users u ORDER BY u.name`);
  const categories = (await all<{ name: string }>("SELECT name FROM task_categories WHERE archived=0 ORDER BY pos, id")).map((c) => c.name);
  return (
    <div className="page">
      <Link href="/admin" className="small">‹ Admin</Link>
      <h1>{t ? `Edit “${t.name}”` : "New task"}</h1>
      <TemplateEditor id={id} initial={t ?? null} initialItems={items} selected={selected} geo={await geo()} people={people} categories={categories}
        checklists={await all<ChecklistPreset>("SELECT * FROM checklist_presets ORDER BY title")}
        schedules={await all<SchedulePreset>("SELECT * FROM schedule_presets ORDER BY name")}
        reviewers={people.filter((x) => x.access_role === "reviewer")} auditors={people.filter((x) => x.access_role === "auditor")} />
    </div>
  );
}
