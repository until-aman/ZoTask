"use client";
// My Tasks for the ground team and CBMs: counts per list on top, then search and filters, then the tasks, 20 a page.
import { fmtDate, fmtDateTime } from "@/lib/time";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ColumnsMenu, ExportMenu, RowMenu, useHiddenCols } from "@/components/ui/TableKit";
import { ActiveChip, DateRow, Field, FilterBar, SearchPick, Pager, clampPage, usePageSize, SavedView, SortHead, SortState, Stats, sameFilters, sortRows } from "@/components/ui/Filters";

export type MyTask = { id: number; task: string; crit: boolean; property: string; category: string; win: string; date: string; dateLabel: string;
  /** When it was scheduled for, and its last step (submitted, reviewed...) with the time. */
  schedAt: number; lastL: string; lastAt: number;
  status: string; label: string; pill: string; due: string; dueAt: number; warn: boolean; cta: string | null };
// The columns after Task, with their widths on a wide and a mid-size screen. Task and Status always show.
const COLS = [
  { key: "prop", label: "Property", w: "minmax(0,1.1fr)", m: "minmax(0,1fr)" },
  { key: "sched", label: "Scheduled", w: "minmax(0,1fr)", m: "minmax(0,.9fr)" },
  { key: "last", label: "Last action", w: "minmax(0,1.2fr)", m: "minmax(0,1.1fr)" },
  { key: "due", label: "Due", w: "minmax(0,1.3fr)", m: "minmax(0,1.1fr)" },
];
const TABS: [string, string][] = [["now", "Current and upcoming"], ["overdue", "Overdue"], ["changes", "Changes required"], ["flags", "Audit flags"], ["done", "Completed"]];

export default function TasksClient({ lists, tab, range, from, to, today, views }: { lists: Record<string, MyTask[]>; tab: string; range: string; from: string; to: string; today: string; views: SavedView[] }) {
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
  const list = sortRows((lists[tab] ?? []).filter(keep), sort, (t, k) => k === "task" ? t.task : k === "prop" ? t.property : k === "due" ? t.dueAt : k === "status" ? t.label : k === "sched" ? t.schedAt : k === "last" ? t.lastAt : null);
  const [size, setSize] = usePageSize();
  const pg = clampPage(page, list.length, size);
  const shown = list.slice(pg * size, pg * size + size);
  const nice = (d: string) => fmtDate(d);
  const dateQ = range === "custom" ? `&range=custom&from=${from}&to=${to}` : range === "today" ? "" : `&range=${range}`;
  const go = (t: string, q = dateQ) => router.push(`/tasks?tab=${t}${q}`);
  const span = from === to ? nice(from) : `${nice(from)} – ${nice(to)}`;
  const chips: ActiveChip[] = [
    ...(prop ? [{ key: "prop", label: <>Property: <b>{prop}</b></>, clear: () => setProp("") }] : []),
    ...(cat ? [{ key: "cat", label: <>Type: <b>{cat}</b></>, clear: () => setCat("") }] : []),
    ...(crit ? [{ key: "crit", label: <>Critical only</>, clear: () => setCrit(false) }] : []),
  ];
  const sortHead = (k: string, l: string) => <SortHead k={k} label={l} sort={sort} setSort={(x) => { setSort(x); setPage(0); }} />;
  const [hidden, toggle] = useHiddenCols("My Tasks");
  const on = (k: string) => !hidden.has(k);
  const vis = COLS.filter((c) => on(c.key));
  const grid = { "--mtcols": ["minmax(0,1.8fr)", ...vis.map((c) => c.w), "260px", "36px"].join(" "), "--mtcols-m": ["minmax(0,1.5fr)", ...vis.map((c) => c.m), "150px", "36px"].join(" ") } as React.CSSProperties;
  const header = ["Task", "Category", "Critical", ...(on("prop") ? ["Property"] : []), ...(on("sched") ? ["Scheduled", "Window"] : []), ...(on("last") ? ["Last action", "Last action at"] : []), ...(on("due") ? ["Due"] : []), "Status"];
  const cells = (l: MyTask[]) => l.map((t) => [t.task, t.category, t.crit ? "Yes" : "", ...(on("prop") ? [t.property] : []), ...(on("sched") ? [t.dateLabel, t.win] : []), ...(on("last") ? [t.lastL, t.lastAt ? fmtDateTime(t.lastAt) : ""] : []), ...(on("due") ? [t.due] : []), t.label]);
  const late = lists.overdue.length + lists.changes.length + lists.flags.length;

  return (
    <div className="page">
      <div className="phead">
        <div><h1>My Tasks</h1>
        <p className="phead-sub">{late ? <b style={{ color: "var(--red)" }}>{lists.overdue.length} overdue · {lists.changes.length} to fix{lists.flags.length ? ` · ${lists.flags.length} audit flags to answer` : ""}</b> : "Nothing overdue. Nice."}</p></div>
      </div>
      <FilterBar search={q} setSearch={(v) => { setQ(v); setPage(0); }} searchLabel="Search tasks" chips={chips}
        onClearAll={() => apply({})}
        dates={<DateRow value={range} from={from} to={to} onPick={(k) => { setPage(0); go(tab, k === "today" ? "" : `&range=${k}`); }}
          onCustom={(f, t) => { setPage(0); go(tab, `&range=custom&from=${f}&to=${t}`); }} />}
        saved={{ page: "tasks", views, current, apply, notify: setToast, name: [prop, cat, crit ? "Critical" : ""].filter(Boolean).join(" · ") || "My filters", note: "Dates are not saved. My Tasks always opens on today." }}
        panel={<>
          {props.length > 1 && <Field label="Property"><SearchPick value={prop} onChange={(v) => { setProp(v); setPage(0); }} allLabel="All properties" placeholder="Type a property name" options={props.map((v) => ({ v }))} /></Field>}
          <Field label="Task type"><select value={cat} onChange={(e) => { setCat(e.target.value); setPage(0); }}><option value="">All types</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Priority"><label className="switch"><input type="checkbox" checked={crit} onChange={(e) => { setCrit(e.target.checked); setPage(0); }} />Critical only</label></Field>
        </>} />
      <Stats compact items={TABS.map(([k, l]) => {
        const n = lists[k].filter(keep).length;
        return { key: k, label: l, value: n, active: tab === k, onClick: () => { setPage(0); go(k); },
          tone: (k === "overdue" || k === "changes" || k === "flags") && n ? (k === "overdue" ? "r" as const : "a" as const) : undefined,
          sub: k === "now" || k === "done" ? span : undefined };
      })} />
      <section className="listcard" aria-label="Tasks" style={grid}>
        <div className="ttool"><span className="small muted">{list.length} task{list.length === 1 ? "" : "s"}</span><span className="spacer" />
          <ColumnsMenu cols={[{ key: "task", label: "Task", fixed: true }, ...COLS, { key: "status", label: "Status", fixed: true }]} hidden={hidden} toggle={toggle} />
          <ExportMenu name={`My Tasks ${TABS.find(([k]) => k === tab)?.[1] ?? ""}`} header={header} rows={() => cells(list)} page={list.length > shown.length ? () => cells(shown) : undefined} /></div>
        <div className="mthead">{sortHead("task", "Task")}{vis.map((c) => <span key={c.key}>{sortHead(c.key, c.label)}</span>)}{sortHead("status", "Status")}<span /></div>
        {!shown.length ? <div className="empty"><b>Nothing here</b>{chips.length || q ? "No tasks match these filters." : tab === "now" ? `No open tasks for ${span}.` : "You're all caught up."}</div>
          : shown.map((r) => (
            <div key={r.id} className="mtrow" onClick={() => router.push(`/tasks/${r.id}`)}>
              <div style={{ minWidth: 0 }}>
                <div className="tname"><Link href={`/tasks/${r.id}`} className="tlink" onClick={(e) => e.stopPropagation()}>{r.task}</Link>{r.crit && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</div>
                <div className="tsub">{r.category}</div>
              </div>
              {on("prop") && <div className="small">{r.property}</div>}
              {on("sched") && <div className="small"><span className="mtl">Scheduled </span>{r.dateLabel}<div className="tsub">{r.win}</div></div>}
              {on("last") && <div className="small"><span className="mtl">Last action </span>{r.lastL}<div className="tsub">{fmtDateTime(r.lastAt)}</div></div>}
              {on("due") && <div className={`small ${r.warn ? "warn" : "muted"}`}>{r.due || "—"}</div>}
              <div className="mtst"><span className={`pill ${r.pill}`}>{r.label}</span>{r.cta && <span className="btn sm primary">{r.cta}</span>}</div>
              <RowMenu label={`Actions for ${r.task}`} actions={[
                { label: r.cta ?? "Open task", onClick: () => router.push(`/tasks/${r.id}`) },
                { label: "Open in a new tab", onClick: () => window.open(`/tasks/${r.id}`, "_blank") },
                { label: "Copy link", onClick: () => navigator.clipboard?.writeText(`${location.origin}/tasks/${r.id}`) },
              ]} />
            </div>
          ))}
        <Pager page={pg} total={list.length} size={size} setPage={setPage} setSize={setSize} />
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
