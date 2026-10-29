"use client";
// Action required: every open problem once, most severe first, with the person who must act and what to do.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Issue, T } from "@/lib/command";
import { acknowledgeIssues, remindTasks } from "@/app/actions";
import { STATUS_LABEL, STATUS_PILL } from "@/lib/statuses";
import { InfoTip, dur, useDrill, CopyModal } from "./parts";
import { ActiveChip, Field, FilterBar, Pager, PAGE, SortState, Stats, nextSort, sortRows } from "@/components/ui/Filters";

const CATS: [Issue["cat"] | "all", string][] = [["all", "All"], ["critical", "Critical"], ["ground", "Ground team overdue"], ["review", "Review SLA breaches"], ["repeat", "Repeated rejections"], ["exception", "Exceptions"]];
const SEVC: Record<string, string> = { Critical: "r", High: "r", Medium: "a", Low: "" };
const SEVN: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const ago = (now: number, at: number) => `${dur(now - at)} ago`;

export default function ActionQueue({ issues, now, me, canEscalate, onIssue, toast, handover }: {
  issues: Issue[]; now: number; me: string; canEscalate: boolean; onIssue: (i: Issue) => void; toast: (m: string) => void;
  handover: { closedToday: number[]; tomorrow: number[]; tasks: Record<number, T>; period: string; scope: string };
}) {
  const router = useRouter();
  const { open } = useDrill();
  const [cat, setCat] = useState<Issue["cat"] | "all">("all");
  const [owner, setOwner] = useState("");
  const [sev, setSev] = useState("");
  const [q, setQ] = useState("");
  const [hideAck, setHideAck] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [ho, setHo] = useState<string | null>(null);
  const owners = useMemo(() => [...new Set(issues.map((i) => i.owner))].sort(), [issues]);
  const list = issues.filter((i) => (cat === "all" || i.cat === cat) && (!owner || i.owner === owner) && (!sev || i.sev === sev) && (!hideAck || (!i.ack && !i.esc))
    && (!q || `${i.task} ${i.property} ${i.owner} ${i.type} ${i.city} ${i.cluster}`.toLowerCase().includes(q.toLowerCase())));
  const sorted = sortRows(list, sort, (i, k) => k === "sev" ? SEVN[i.sev] : k === "issue" ? i.type : k === "prop" ? i.property : k === "owner" ? i.owner
    : k === "status" ? (i.id ? STATUS_LABEL[i.status] : "Property") : k === "over" ? i.overdue : k === "back" ? i.rejections : null);
  const pg = Math.min(page, Math.max(0, Math.ceil(sorted.length / PAGE) - 1));
  const view = sorted.slice(pg * PAGE, pg * PAGE + PAGE);
  const chips: ActiveChip[] = [
    ...(owner ? [{ key: "owner", label: <>Owner: <b>{owner}</b></>, clear: () => setOwner("") }] : []),
    ...(sev ? [{ key: "sev", label: <>Severity: <b>{sev}</b></>, clear: () => setSev("") }] : []),
    ...(hideAck ? [{ key: "ack", label: <>Hiding acknowledged</>, clear: () => setHideAck(false) }] : []),
  ];
  const Th = ({ k, label, n }: { k: string; label: string; n?: boolean }) => (
    <th className={n ? "n" : ""} aria-sort={sort?.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="sortbtn" onClick={() => { setSort(nextSort(sort, k)); setPage(0); }}>{label}<span className="sorti">{sort?.key === k ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button>
    </th>
  );
  const selIssues = issues.filter((i) => sel.has(i.key) && i.id);
  const run = async (p: Promise<{ ok: boolean; msg?: string; error?: string }>) => { const r = await p; toast(r.ok ? r.msg ?? "Done" : r.error ?? "Failed"); setSel(new Set()); if (r.ok) router.refresh(); };

  const makeHandover = () => {
    const line = (i: Issue) => `- [${i.sev}] ${i.task} · ${i.property} · ${i.type}${i.overdue ? ` · ${dur(i.overdue)} over` : ""} · owner ${i.owner}${i.esc ? ` · ${i.esc.detail}` : i.ack ? ` · acknowledged by ${i.ack.by}` : ""}`;
    const sec = (title: string, xs: Issue[]) => `${title} (${xs.length})\n${xs.length ? xs.slice(0, 15).map(line).join("\n") + (xs.length > 15 ? `\n- …and ${xs.length - 15} more` : "") : "- None"}`;
    const t = handover.tasks;
    return [
      `ZoTask daily handover · ${new Date(now).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      `Scope: ${handover.scope}`, "",
      sec("1. Critical unresolved", issues.filter((i) => i.sev === "Critical")),
      sec("2. Ground team overdue", issues.filter((i) => i.cat === "ground")),
      sec("3. Reviewer backlog past SLA", issues.filter((i) => i.cat === "review")),
      sec("4. Repeatedly rejected", issues.filter((i) => i.cat === "repeat")),
      sec("5. Escalations not yet acknowledged", issues.filter((i) => i.esc && !(i.ack && i.ack.at > (i.esc?.at ?? 0)))),
      `6. Approved or closed today (${handover.closedToday.length})\n${handover.closedToday.slice(0, 10).map((id) => `- ${t[id]?.task} · ${t[id]?.property}`).join("\n") || "- None"}`,
      `7. Follow up tomorrow (${handover.tomorrow.length} late tasks whose grace period ends tomorrow)\n${handover.tomorrow.slice(0, 10).map((id) => `- ${t[id]?.task} · ${t[id]?.property} · ${t[id]?.assignee}`).join("\n") || "- None"}`,
    ].join("\n\n");
  };

  const count = (c: Issue["cat"] | "all") => (c === "all" ? issues.length : issues.filter((i) => i.cat === c).length);
  return (
    <section className="card sec" id="actions">
      <div className="sech">
        <h2>Action required<InfoTip title="Action required" rows={[["Order", "Severity first, then how long it is past its limit"], ["Critical", "A critical task not done, or on its last attempt"], ["High", "Twice the time limit, last attempt left, or no reviewer"], ["Owner", "The one person who must act next"], ["Stays", "Until the task moves on. Acknowledging doesn't hide it"]]} note="Each task appears once, under its most serious problem." /></h2>
        <span className="pill">{issues.length}</span><span className="spacer" />
        <button type="button" className="btn sm" onClick={() => setHo(makeHandover())}>Daily handover</button>
      </div>
      <Stats items={CATS.map(([k, l]) => ({ key: k, label: l, value: count(k), tone: k === "critical" && count(k) ? "r" as const : undefined, active: cat === k,
        onClick: () => { setCat(k); setSel(new Set()); setPage(0); } }))} />
      <FilterBar search={q} setSearch={(v) => { setQ(v); setPage(0); }} searchLabel="Search task, property, person" chips={chips}
        onClearAll={() => { setOwner(""); setSev(""); setHideAck(false); }}
        panel={<>
          <Field label="Owner"><select value={owner} onChange={(e) => { setOwner(e.target.value); setPage(0); }}><option value="">All owners</option>{owners.includes(me) && <option value={me}>Me ({me})</option>}{owners.filter((o) => o !== me).map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Severity"><select value={sev} onChange={(e) => { setSev(e.target.value); setPage(0); }}><option value="">All severities</option>{["Critical", "High", "Medium", "Low"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Acknowledged"><label className="switch"><input type="checkbox" checked={hideAck} onChange={(e) => { setHideAck(e.target.checked); setPage(0); }} />Hide acknowledged</label></Field>
        </>} />
      {sel.size > 0 && <div className="bulk" style={{ borderRadius: 8 }}>
        {sel.size} selected<span className="spacer" />
        <button type="button" className="btn sm primary" onClick={() => run(remindTasks(selIssues.map((i) => i.id!)))}>Send reminders</button>
        <button type="button" className="btn sm" onClick={() => run(acknowledgeIssues(selIssues.map((i) => i.id!)))}>Acknowledge</button>
        <button type="button" className="link small" onClick={() => setSel(new Set())}>Clear</button>
      </div>}
      {!list.length ? <div className="empty"><b>{issues.length ? "Nothing matches these filters" : "Nothing needs action"}</b>{issues.length ? "Try another type or owner." : "No overdue tasks, late reviews or repeat rejections right now."}</div> : (
        <div className="tbl"><table className="aq">
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all shown" checked={view.filter((i) => i.id).every((i) => sel.has(i.key)) && view.some((i) => i.id)}
              onChange={(e) => setSel(e.target.checked ? new Set(view.filter((i) => i.id).map((i) => i.key)) : new Set())} /></th>
            <Th k="sev" label="Severity" /><Th k="issue" label="Issue" /><Th k="prop" label="Property" /><Th k="owner" label="Responsible" /><Th k="status" label="Status" /><Th k="over" label="Over limit" n /><Th k="back" label="Sent back" n /><th>Latest comment</th><th />
          </tr></thead>
          <tbody>{view.map((i) => (
            <tr key={i.key}>
              <td>{i.id ? <input type="checkbox" checked={sel.has(i.key)} aria-label={`Select ${i.task}`} onChange={() => { const n = new Set(sel); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); setSel(n); }} /> : null}</td>
              <td><span className={`pill ${SEVC[i.sev]}`}>{i.sev}</span></td>
              <td style={{ minWidth: 200 }}>
                <b>{i.type}</b><div className="tsub" style={{ whiteSpace: "normal" }}>{i.task}</div>
                {i.esc ? <div className="small warn" style={{ fontWeight: 600 }}>{i.esc.detail.split(" · ")[0]} · {ago(now, i.esc.at)}</div>
                  : i.ack ? <div className="small muted">✓ Acknowledged by {i.ack.by} · {ago(now, i.ack.at)}</div> : null}
              </td>
              <td><div>{i.property}</div><div className="tsub">{i.cluster}, {i.city}</div></td>
              <td><div>{i.owner}</div><div className="tsub">{i.ownerRole}</div></td>
              <td>{i.id ? <span className={`pill ${STATUS_PILL[i.status]}`}>{STATUS_LABEL[i.status]}</span> : <span className="pill">Property</span>}</td>
              <td className="n">{i.overdue ? <span className={i.overdue > 24 * 3600_000 ? "warn" : ""}>{dur(i.overdue)}</span> : "—"}</td>
              <td className="n">{i.rejections || "—"}</td>
              <td className="cmt" title={i.comment ?? ""}>{i.comment ?? <span className="muted">—</span>}</td>
              <td><div className="acts">
                {i.id ? <>
                  <button type="button" className="btn sm" onClick={() => onIssue(i)}>View</button>
                  <button type="button" className="btn sm" onClick={() => run(remindTasks([i.id!]))}>Remind</button>
                  {canEscalate && !i.esc && <button type="button" className="btn sm danger" onClick={() => onIssue(i)} title="Open the task to escalate with a note">Escalate</button>}
                </> : <button type="button" className="btn sm" onClick={() => open({ title: `${i.property}: missed tasks`, ids: i.ids })}>View tasks</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager page={pg} total={sorted.length} setPage={setPage} />
      {ho !== null && <CopyModal title="Daily handover" text={ho} close={() => setHo(null)} />}
    </section>
  );
}
