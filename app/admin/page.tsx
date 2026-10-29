import Link from "next/link";
import { redirect } from "next/navigation";
import { boot } from "@/lib/boot";
import { can } from "@/lib/auth";
import { all } from "@/lib/db";
import { geo } from "@/lib/queries";
import TriggerForm from "@/components/TriggerForm";

export default async function Admin() {
  const u = await boot();
  if (!can.admin(u)) redirect("/");
  const templates = all<{ id: number; name: string; category: string; op_role: string; trigger: string; event_name: string | null; frequency: string; window_start: string; window_end: string; review_sla_h: number; audit_sla_h: number; attempts_allowed: number; criticality: string; audit_rate: number; active: number; props: number; reviewer: string | null; auditor: string | null }>(
    `SELECT t.*, (SELECT count(*) FROM template_properties tp WHERE tp.template_id=t.id) props, r.name reviewer, a.name auditor
     FROM templates t LEFT JOIN users r ON r.id=t.reviewer_id LEFT JOIN users a ON a.id=t.auditor_id ORDER BY t.id`);
  const props = all<{ id: number; name: string; cluster: string; city: string; cbm: string | null; staff: number }>(
    `SELECT p.id, p.name, cl.name cluster, c.name city, u.name cbm,
      (SELECT count(*) FROM user_properties up JOIN users x ON x.id=up.user_id WHERE up.property_id=p.id AND x.access_role='ground') staff
     FROM properties p JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id LEFT JOIN users u ON u.id=p.cbm_id ORDER BY c.name, cl.name, p.name`);
  const people = all<{ access_role: string; n: number }>("SELECT access_role, count(*) n FROM users GROUP BY access_role");
  return (
    <div className="page">
      <div className="row2"><h1>Admin</h1><span className="spacer" /><Link className="btn primary" href="/admin/templates/new">+ New task</Link></div>
      <section>
        <h2>Task setup</h2>
        <div className="tbl"><table>
          <thead><tr><th>Task</th><th>Category</th><th>Role</th><th>When</th><th>Window</th><th className="n">Review / audit SLA</th><th className="n">Attempts</th><th className="n">Audit sample</th><th>Reviewer · Auditor</th><th className="n">Properties</th><th /></tr></thead>
          <tbody>{templates.map((t) => (
            <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
              <td><b>{t.name}</b>{t.criticality === "high" && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}{!t.active && <span className="pill" style={{ marginLeft: 6 }}>Paused</span>}</td>
              <td>{t.category}</td><td>{t.op_role}</td>
              <td>{t.trigger === "scheduled" ? t.frequency : t.trigger === "event" ? `On “${t.event_name}”` : "On demand"}</td>
              <td>{t.window_start}–{t.window_end}</td>
              <td className="n">{t.review_sla_h}h / {t.audit_sla_h}h</td><td className="n">{t.attempts_allowed}</td><td className="n">{Math.round(t.audit_rate * 100)}%</td>
              <td className="small">{t.reviewer ?? "—"} · {t.auditor ?? "—"}</td><td className="n">{t.props}</td>
              <td><Link href={`/admin/templates/${t.id}`}>Edit</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <TriggerForm templates={templates.filter((t) => t.trigger !== "scheduled" && t.active).map((t) => ({ id: t.id, name: t.name, label: t.event_name ?? "On demand" }))}
        properties={geo().map((g) => ({ id: g.id, name: `${g.property} · ${g.city}` }))} />
      <div className="grid g2">
        <section>
          <h2>Properties</h2>
          <div className="tbl"><table>
            <thead><tr><th>Property</th><th>Cluster</th><th>City</th><th>CBM</th><th className="n">Ground staff</th></tr></thead>
            <tbody>{props.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.cluster}</td><td>{p.city}</td><td>{p.cbm}</td><td className="n">{p.staff}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section>
          <h2>People</h2>
          <div className="tbl"><table>
            <thead><tr><th>Role</th><th className="n">People</th></tr></thead>
            <tbody>{people.map((p) => <tr key={p.access_role}><td>{p.access_role}</td><td className="n">{p.n}</td></tr>)}</tbody>
          </table></div>
          <p className="small muted">Roles here are operational roles only (admin, reviewer, auditor, CBM, ground team), not system access roles.</p>
        </section>
      </div>
    </div>
  );
}
