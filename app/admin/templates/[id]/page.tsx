import Link from "next/link";
import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { Template, itemsFor } from "@/lib/engine";
import { geo } from "@/lib/queries";
import TemplateEditor from "@/components/TemplateEditor";

export default async function EditTemplate({ params }: { params: Promise<{ id: string }> }) {
  const u = await boot();
  if (!can.admin(u)) redirect("/");
  const raw = (await params).id;
  const id = raw === "new" ? null : Number(raw);
  const t = id ? await one<Template>("SELECT * FROM templates WHERE id=?", id) : undefined;
  if (id && !t) redirect("/admin");
  const items = id ? (await itemsFor(id)).filter((i) => i.pos < 1000) : [];
  const selected = id ? (await all<{ property_id: number }>("SELECT property_id FROM template_properties WHERE template_id=?", id)).map((x) => x.property_id) : [];
  const users = await all<{ id: number; name: string; access_role: string }>("SELECT id, name, access_role FROM users WHERE access_role IN ('reviewer','auditor') ORDER BY name");
  return (
    <div className="page narrow">
      <Link href="/admin" className="small">‹ Admin</Link>
      <h1>{t ? `Edit “${t.name}”` : "New task"}</h1>
      <TemplateEditor id={id} initial={t ?? null} initialItems={items} selected={selected} geo={await geo()}
        reviewers={users.filter((x) => x.access_role === "reviewer")} auditors={users.filter((x) => x.access_role === "auditor")} />
    </div>
  );
}
