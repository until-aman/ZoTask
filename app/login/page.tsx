import { all } from "@/lib/db";
import { signIn } from "../actions";

const GROUPS: [string, string, string][] = [
  ["admin", "Admin", "Configures tasks, properties and people"],
  ["reviewer", "Central reviewers", "Pass or send back submitted tasks"],
  ["auditor", "Auditors", "Re-check a sample of passed tasks"],
  ["cbm", "Cluster Business Managers", "Own their properties, do CBM tasks, answer audit flags"],
  ["ground", "Ground team", "Do the daily checklists at a property"],
];

export default async function Login() {
  const users = await all<{ id: number; name: string; access_role: string; op_role: string | null; props: string | null }>(
    `SELECT u.id, u.name, u.access_role, u.op_role,
      (SELECT group_concat(p.name, ', ') FROM user_properties up JOIN properties p ON p.id=up.property_id WHERE up.user_id=u.id) props
     FROM users u ORDER BY u.id`);
  return (
    <div className="page narrow">
      <div>
        <h1>Sign in to ZoTask</h1>
        <p className="muted">This is a local copy with sample data, so pick anyone to see ZoTask from their side.</p>
      </div>
      {GROUPS.map(([role, title, blurb]) => (
        <section key={role} className="card">
          <h2>{title}</h2>
          <p className="muted small" style={{ marginTop: -4 }}>{blurb}</p>
          <div className="row2">
            {users.filter((u) => u.access_role === role).map((u) => (
              <form key={u.id} action={signIn}>
                <input type="hidden" name="id" value={u.id} />
                <button className="btn" title={u.props ?? ""}>
                  {u.name}
                  {role === "ground" && <span className="pill">{u.op_role} · {u.props}</span>}
                </button>
              </form>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
