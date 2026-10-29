"use client";
// My Tasks for the ground team and CBMs: counts per list on top, then search and filters, then the tasks, 20 a page.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActiveChip, Field, FilterBar, PAGE, Pager, SavedView, SortHead, SortState, Stats, sameFilters, sortRows } from "@/components/ui/Filters";

export type MyTask = { id: number; task: string; crit: boolean; property: string; category: string; win: string; date: string; dateLabel: string;
  status: string; label: string; pill: string; due: string; dueAt: number; warn: boolean; cta: string | null };
const TABS: [string, string][] = [["now", "Current and upcoming"], ["overdue", "Overdue"], ["changes", "Changes required"], ["flags", "Audit flags"], ["done", "Completed"]];

export default function TasksClient({ lists, tab, date, today, views }: { lists: Record<string, MyTask[]>; tab: string; date: string; today: string; views: SavedView[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [prop, setProp] = useState("");
  const [cat, setCat] = useState("");
  const [crit, setCrit] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  const current = { prop, cat, crit };
  const apply = (f: Record<string, unknown>) => { setProp(String(f.prop ?? "")); setCat(String(f.cat ?? "")); setCrit(!!f.crit); setPage(0); };
  const def = views.find((v) => v.def);
  useEffect(() => { if (def && !sameFilters(def.f, current)) apply(def.f); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const everything = Object.values(lists).flat();
  const props = [...new Set(everything.map((t) => t.property))].sort(), cats = [...new Set(everything.map((t) => t.category))].sort();
  const keep = (t: MyTask) => (!prop || t.property === prop) && (!cat || t.category === cat) && (!crit || t.crit)
    && (!q || `${t.task} ${t.property} ${t.category}`.toLowerCase().includes(q.toLowerCase()));
  const list = sortRows((lists[tab] ?? []).filter(keep), sort, (t, k) => k === "task" ? t.task : k === "prop" ? t.property : k === "due" ? t.dueAt : k === "status" ? t.label : null);
  const pg = Math.min(page, Math.max(0, Math.ceil(list.length / PAGE) - 1));
  const shown = list.slice(pg * PAGE, pg * PAGE + PAGE);
  const go = (t: string, d = date) => router.push(`/tasks?tab=${t}&date=${d}`);
  const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const chips: ActiveChip[] = [
    ...(date !== today ? [{ key: "date", label: <>Date: <b>{nice(date)}</b></>, clear: () => go(tab, today) }] : []),
    ...(prop ? [{ key: "prop", label: <>Property: <b>{prop}</b></>, clear: () => setProp("") }] : []),
    ...(cat ? [{ key: "cat", label: <>Type: <b>{cat}</b></>, clear: () => setCat("") }] : []),
    ...(crit ? [{ key: "crit", label: <>Critical only</>, clear: () => setCrit(false) }] : []),
  ];
  const sortHead = (k: string, l: string) => <SortHead k={k} label={l} sort={sort} setSort={(x) => { setSort(x); setPage(0); }} />;
  const late = lists.overdue.length + lists.changes.length + lists.flags.length;

  return (
    <div className="page narrow">
      <div>
        <h1>My Tasks</h1>
        <p className="muted" style={{ margin: "2px 0 0" }}>{late ? <b style={{ color: "var(--red)" }}>{lists.overdue.length} overdue · {lists.changes.length} to fix{lists.flags.length ? ` · ${lists.flags.length} audit flags to answer` : ""}</b> : "Nothing overdue. Nice."}</p>
      </div>
      <Stats items={TABS.map(([k, l]) => {
        const n = lists[k].filter(keep).length;
        return { key: k, label: l, value: n, active: tab === k, onClick: () => { setPage(0); go(k); },
          tone: (k === "overdue" || k === "changes" || k === "flags") && n ? (k === "overdue" ? "r" as const : "a" as const) : undefined,
          sub: k === "now" || k === "done" ? nice(date) : undefined };
      })} />
      <FilterBar search={q} setSearch={(v) => { setQ(v); setPage(0); }} searchLabel="Search tasks" chips={chips}
        onClearAll={() => { apply({}); if (date !== today) go(tab, today); }}
        saved={{ page: "tasks", views, current, apply, notify: setToast, name: [prop, cat, crit ? "Critical" : ""].filter(Boolean).join(" · ") || "My filters", note: "The date is not saved. My Tasks always opens on today." }}
        panel={<>
          <Field label="Date"><input type="date" id="tasks-date" value={date} onChange={(e) => e.target.value && go(tab, e.target.value)} /></Field>
          {props.length > 1 && <Field label="Property"><select value={prop} onChange={(e) => { setProp(e.target.value); setPage(0); }}><option value="">All properties</option>{props.map((p) => <option key={p}>{p}</option>)}</select></Field>}
          <Field label="Task type"><select value={cat} onChange={(e) => { setCat(e.target.value); setPage(0); }}><option value="">All types</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Priority"><label className="switch"><input type="checkbox" checked={crit} onChange={(e) => { setCrit(e.target.checked); setPage(0); }} />Critical only</label></Field>
        </>} />
      <section className="listcard" aria-label="Tasks">
        <div className="mthead">{sortHead("task", "Task")}{sortHead("prop", "Property")}{sortHead("due", "Due")}{sortHead("status", "Status")}</div>
        {!shown.length ? <div className="empty"><b>Nothing here</b>{chips.length || q ? "No tasks match these filters." : tab === "now" ? `No open tasks on ${nice(date)}.` : "You're all caught up."}</div>
          : shown.map((r) => (
            <Link key={r.id} href={`/tasks/${r.id}`} className="mtrow">
              <div style={{ minWidth: 0 }}>
                <div className="tname">{r.task}{r.crit && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</div>
                <div className="tsub">{r.win} · {r.dateLabel}</div>
              </div>
              <div className="small">{r.property}</div>
              <div className={`small ${r.warn ? "warn" : "muted"}`}>{r.due || "—"}</div>
              <div className="mtst"><span className={`pill ${r.pill}`}>{r.label}</span>{r.cta && <span className="btn sm primary">{r.cta}</span>}</div>
            </Link>
          ))}
        <div style={{ padding: "8px 12px" }}><Pager page={pg} total={list.length} setPage={setPage} /></div>
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
