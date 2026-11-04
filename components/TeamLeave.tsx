"use client";
// Team leave: each person's weekly days off, leave and backup. While someone is off, their tasks go to their backup
// (or a teammate with the same role at that property); with nobody to cover, the task is excused and not counted.
// Reviews and audits waiting for someone who's off go to their backup; with no backup, their clock pauses.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addLeave, removeLeave, saveWeekOff } from "@/app/actions";
import type { TeamPerson } from "@/lib/team";
import { Table, type Col } from "@/components/cc/parts";
import { Field, FilterBar, SearchPick, Stats } from "@/components/ui/Filters";
import { Person } from "@/components/ui/TableKit";
import { personOffWhy } from "@/lib/offdays";
import { addDays, fmtDate } from "@/lib/time";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ROLE: Record<string, string> = { admin: "Admin", reviewer: "Reviewer", auditor: "Auditor", cbm: "CBM", ground: "Ground team" };
const short = (d: string) => fmtDate(d, { day: "numeric", month: "short" });
const range = (l: { from: string; to: string }) => (l.from === l.to ? short(l.from) : `${short(l.from)} – ${short(l.to)}`);
const offOf = (p: TeamPerson) => ({ week: p.week, backup: p.backup_id, leaves: p.leaves.map((l) => ({ from: l.from, to: l.to, note: l.note })) });

type Data = { people: TeamPerson[]; options: Record<number, number[]>; names: Record<number, string>; today: string };

export default function TeamLeave({ data, admin }: { data: Data; admin: boolean }) {
  const router = useRouter();
  const { people, names, today } = data;
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [show, setShow] = useState<"" | "off" | "nobackup">("");
  const [edit, setEdit] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const offToday = (p: TeamPerson) => personOffWhy(offOf(p), today);
  const rows = useMemo(() => people.filter((p) => (!role || p.access_role === role) && (show !== "off" || offToday(p)) && (show !== "nobackup" || !p.backup_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, role, show]);
  const nOff = people.filter((p) => offToday(p)).length, nNoBackup = people.filter((p) => !p.backup_id).length;
  const week = people.filter((p) => p.leaves.some((l) => l.to >= today && l.from <= addDays(today, 6))).length;
  const cols: Col<TeamPerson>[] = [
    { key: "name", label: "Person", sticky: true, value: (p) => p.name, render: (p) => <Person name={p.name} sub={[ROLE[p.access_role] ?? p.access_role, p.op_role].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ")} /> },
    { key: "props", label: "Properties", value: (p) => p.props, render: (p) => <span className="small" title={p.props}>{p.propIds.length ? (p.propIds.length > 2 ? `${p.props.split(", ").slice(0, 2).join(", ")} +${p.propIds.length - 2}` : p.props) : <span className="muted">All (central team)</span>}</span> },
    { key: "today", label: "Today", value: (p) => offToday(p) ?? "Working", render: (p) => { const w = offToday(p); return w ? <span className="pill a">{w}</span> : <span className="small muted">Working</span>; } },
    { key: "week", label: "Weekly off", value: (p) => p.week.map((d) => DAYS[d]).join(", ") || null, render: (p) => p.week.length ? p.week.map((d) => DAYS[d]).join(", ") : <span className="muted">None</span> },
    { key: "leave", label: "Leave", value: (p) => p.leaves.filter((l) => l.to >= today).map(range).join(", ") || null,
      render: (p) => { const up = p.leaves.filter((l) => l.to >= today); return up.length ? <span className="small">{up.slice(0, 2).map(range).join(", ")}{up.length > 2 ? ` +${up.length - 2}` : ""}</span> : <span className="muted">None</span>; } },
    { key: "backup", label: "Backup", value: (p) => (p.backup_id ? names[p.backup_id] : null), render: (p) => (p.backup_id ? names[p.backup_id] : <span className="t-a small">Not set</span>) },
  ];
  const editing = people.find((p) => p.id === edit) ?? null;
  return (
    <div className="page grid" style={{ gap: 14 }}>
      <div className="phead"><div><h1>Team leave</h1><p className="phead-sub">Each person&apos;s weekly day off, leave and backup.</p></div></div>
      <p className="small muted" style={{ margin: 0, maxWidth: 820 }}>
        On someone&apos;s days off, their new and open tasks go to their backup, or to a teammate with the same role at that property. If nobody can cover,
        the task is excused: it isn&apos;t counted as missed and doesn&apos;t affect anyone&apos;s score. Reviews and audits waiting for someone who&apos;s off move
        to their backup. Without a backup, their review clock pauses until they&apos;re back.
      </p>
      <Stats items={[
        { key: "all", label: "People", value: people.length, active: !show, onClick: () => setShow("") },
        { key: "off", label: "Off today", value: nOff, tone: nOff ? "a" : undefined, active: show === "off", onClick: () => setShow(show === "off" ? "" : "off") },
        { key: "wk", label: "On leave in the next 7 days", value: week },
        { key: "nb", label: "No backup set", value: nNoBackup, tone: nNoBackup ? "a" : undefined, active: show === "nobackup", onClick: () => setShow(show === "nobackup" ? "" : "nobackup") },
      ]} />
      <FilterBar search={q} setSearch={setQ} searchLabel="Search people"
        chips={role ? [{ key: "role", label: <>Role: <b>{ROLE[role]}</b></>, clear: () => setRole("") }] : []}
        panel={admin ? <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field> : undefined} />
      <Table name="Team leave" rows={rows} rowKey={(p) => p.id} cols={cols} query={q} initialSort={undefined}
        actions={(p) => [{ label: "Set days off and backup…", onClick: () => setEdit(p.id) }]} empty="Nobody here for these filters." />
      {editing && <Editor p={editing} options={data.options[editing.id] ?? []} names={names} today={today}
        close={() => setEdit(null)} done={(m) => { setToast(m); router.refresh(); setTimeout(() => setToast(""), 4000); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Editor({ p, options, names, today, close, done }: {
  p: TeamPerson; options: number[]; names: Record<number, string>; today: string; close: () => void; done: (m: string) => void;
}) {
  const [week, setWeek] = useState<number[]>(p.week);
  const [backup, setBackup] = useState<number | null>(p.backup_id);
  const [lv, setLv] = useState({ from: today, to: today, note: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(week) !== JSON.stringify(p.week) || backup !== p.backup_id;
  async function go(f: () => Promise<{ ok: boolean; msg?: string; error?: string }>) {
    setBusy(true); setErr("");
    const r = await f();
    setBusy(false);
    if (r.ok) done(r.msg ?? "Saved"); else setErr(r.error ?? "Couldn't save");
    return r.ok;
  }
  const upcoming = p.leaves.filter((l) => l.to >= today), past = p.leaves.filter((l) => l.to < today);
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-label={`Days off for ${p.name}`}>
        <div className="row2" style={{ padding: "16px 18px", borderBottom: "1px solid var(--line)" }}>
          <Person name={p.name} sub={ROLE[p.access_role] ?? p.access_role} /><span className="spacer" />
          <button type="button" className="x" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="grid" style={{ gap: 18, padding: 18, overflow: "auto" }}>
          <div className="f">Weekly day off
            <div className="te-days" role="group" aria-label="Weekly day off">
              {DAYS.map((d, i) => <button key={d} type="button" aria-pressed={week.includes(i)}
                onClick={() => setWeek(week.includes(i) ? week.filter((x) => x !== i) : [...week, i].sort())}>{d}</button>)}
            </div>
            <span className="small muted" style={{ fontWeight: 400 }}>Every week on these days. Up to 3 days.</span>
          </div>
          <div className="f">Backup
            <SearchPick value={backup ? String(backup) : ""} allLabel="No backup" placeholder="Type a name"
              options={options.map((id) => ({ v: String(id), label: names[id] }))} onChange={(v) => setBackup(v ? Number(v) : null)} />
            <span className="small muted" style={{ fontWeight: 400 }}>Covers {p.name.split(" ")[0]}&apos;s tasks on days off.{p.access_role === "ground" ? " Without one, a teammate with the same role at the property takes them." : ""}</span>
          </div>
          <div className="row2"><button type="button" className="btn primary sm" disabled={!dirty || busy} onClick={() => go(() => saveWeekOff(p.id, week, backup))}>Save week off and backup</button></div>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: 0, width: "100%" }} />
          <div className="f">Leave
            <div className="lib-list" style={{ display: "grid", gap: 4 }}>
              {upcoming.length ? upcoming.map((l) => (
                <div key={l.id} className="lib-row row2"><b>{range(l)}</b>{l.from <= today && <span className="pill a">Now</span>}<span className="small muted">{l.note}</span><span className="spacer" />
                  <button type="button" className="link" disabled={busy} onClick={() => go(() => removeLeave(l.id))}>Remove</button></div>
              )) : <span className="small muted" style={{ fontWeight: 400 }}>No leave coming up.</span>}
            </div>
          </div>
          <form className="grid" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await go(() => addLeave(p.id, lv.from, lv.to, lv.note))) setLv({ from: today, to: today, note: "" }); }}>
            <div className="row2" style={{ gap: 8, alignItems: "end" }}>
              <label className="f">From<input type="date" value={lv.from} onChange={(e) => setLv({ ...lv, from: e.target.value, to: lv.to < e.target.value ? e.target.value : lv.to })} /></label>
              <label className="f">To<input type="date" value={lv.to} min={lv.from} onChange={(e) => setLv({ ...lv, to: e.target.value })} /></label>
            </div>
            <label className="f">Note (optional)<input type="text" value={lv.note} maxLength={80} placeholder="e.g. Sick leave, family function" onChange={(e) => setLv({ ...lv, note: e.target.value })} /></label>
            <div className="row2"><button type="submit" className="btn sm" disabled={busy || !lv.from}>Add leave</button></div>
          </form>
          {past.length > 0 && <p className="small muted" style={{ margin: 0 }}>Recent leave: {past.map(range).join(", ")}</p>}
          {err && <div className="err" role="alert">{err}</div>}
        </div>
      </aside>
    </>
  );
}
