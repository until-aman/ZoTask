"use client";
// Review Queue, following the Phase 1 mockup: City → Cluster → Property multi-select, dates default to today and
// apply to every tab, saved filters with a default view, status sidebar grouped by who acts next.
import { addDays, fmtDate, fmtDateTime } from "@/lib/time";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { writeUrl } from "@/components/ui/useUrlState";
import { getHistory, pullBackTask, reassignReviewer, remindTasks, ViewFilters } from "@/app/actions";
import { ColumnsMenu, ExportMenu, Person, RowMenu, useClearOnRowMenu, useHiddenCols } from "@/components/ui/TableKit";
import { ActiveChip, DateRow, Field, FilterBar, SearchPick, Pager, clampPage, usePageSize, SavedView, SortHead, SortState, Stats, sortRows } from "@/components/ui/Filters";

export type QItem = {
  id: number; t: string; p: string; cluster: string; city: string; a: string; r: string; s: string; h: number; sla: number; att: string;
  last: boolean; rv: string; au: string; cbm: string; date: string; why: string; win: string; crit: boolean; next: string; mine: boolean;
  /** When it was scheduled for, and its last step (submitted, reviewed...) with the time. */
  schedAt: number; lastL: string; lastAt: number;
  /** Central team only: submitted on a reviewer day off ("must" check or "auto" close), why, and when it closes by itself. */
  wk?: "must" | "auto"; wkWhy?: string; wkClose?: number;
  /** Central team only: closed by weekend sampling, and whether it can still be pulled back. */
  wkClosedAt?: number; pull?: boolean;
};
type Geo = { city: string; cluster: string; property: string; id: number };
type Ev = { id: number; at: number; type: string; detail: string; actor: string | null };

const GROUPS = [
  { n: "Waiting on the reviewer", short: "With reviewers", tabs: [["review", "To Review"], ["resub", "Resubmitted"], ["weekend", "Weekend"]], open: true, c: "var(--accent)" },
  { n: "Waiting on the auditor", short: "With auditor", tabs: [["audit", "To Audit"], ["flagans", "Flag Answers"]], open: true, c: "var(--navy)" },
  { n: "Waiting on ground team or CBM", short: "With ground team", tabs: [["changes", "Changes Required"], ["notsub", "Not Submitted"], ["auditflag", "Audit Flags"]], open: true, ground: true, c: "var(--amber)" },
  { n: "Closed", short: "Closed", tabs: [["done", "Done"], ["missed", "Missed"], ["notrect", "Not rectified"], ["waived", "Waived"], ["wkclosed", "Auto-closed"]], open: false, c: "var(--faint)" },
] as const;
const grpOf = (k: string) => GROUPS.find((g) => g.tabs.some((t) => t[0] === k))!;
const tabName = (k: string) => grpOf(k).tabs.find((t) => t[0] === k)![1];
const ROLES = ["CBM", "HK", "CC", "Reception", "Short stays"];
const RNAME: Record<string, string> = { CBM: "Cluster Business Manager", HK: "Housekeeping Supervisor (HK)", CC: "Customer Care Executive (CC)", Reception: "Front Office / Reception Executive", "Short stays": "Short Stays Operations Executive" };

// Columns after Task, with their widths. Task always shows.
const QCOLS = [
  { key: "asg", label: "Assignee", w: "minmax(0,1.2fr)" },
  { key: "sched", label: "Scheduled", w: "minmax(0,1fr)" },
  { key: "last", label: "Last action", w: "minmax(0,1.2fr)" },
  { key: "next", label: "Next step", w: "minmax(0,1.5fr)" },
  { key: "wait", label: "Waiting", w: "150px" },
];
const nice = (s: string) => fmtDate(s);
const fmtH = (h: number) => (h >= 48 ? Math.round(h / 24) + " days" : h + "h");
const over = (t: QItem) => t.sla > 0 && t.h > t.sla;
const bucket = (t: QItem) => (t.h > 72 ? "r" : t.h >= 24 ? "a" : "g");
const empty: ViewFilters = { city: [], cluster: [], prop: [], role: [], asg: [], cbm: [], rv: [], mine: false };

// Tabs only the central team sees: off-day submissions and the ones that closed by themselves.
const CENTRAL_TABS = ["weekend", "wkclosed"];
const isWeekend = (t: QItem) => !!t.wk && (t.s === "review" || t.s === "resub");

export default function QueueClient({ items, geo, views, reviewers, me, canReview, isAdmin, canEscalate, isCentral, pullbackDays, today, initial }: {
  items: QItem[]; geo: Geo[]; views: SavedView[]; reviewers: { id: number; name: string }[]; me: string; canReview: boolean; isAdmin: boolean; canEscalate: boolean; today: string;
  isCentral: boolean; pullbackDays: number;
  initial: { tab?: string; city?: string[]; cluster?: string[]; prop?: string[]; from?: string; to?: string; bucket?: string; over?: boolean };
}) {
  const router = useRouter();
  // Everything about the view lives in the address, so Back from a review sheet lands on the same tab, filters, search, page and open task.
  const sp = useSearchParams();
  const g0 = (k: string) => sp?.get(k) ?? null, l0 = (k: string) => g0(k)?.split("|").filter(Boolean) ?? [];
  // On Back the page comes from the browser's memory with the first load's server data, so the address is the truth for the view.
  if (sp) initial = { ...initial, tab: g0("tab") ?? undefined, city: g0("city") ? l0("city") : undefined, cluster: g0("cluster") ? l0("cluster") : undefined,
    prop: g0("prop") ? l0("prop") : undefined, from: g0("from") ?? undefined, to: g0("to") ?? undefined, bucket: g0("bucket") ?? undefined, over: g0("over") === "1" };
  const d0 = g0("d"), sort0 = g0("sort");
  const fromLink = !!(initial.tab || initial.city || initial.prop || initial.from || d0 || g0("role") || g0("asg") || g0("cbm") || g0("rv") || g0("mine"));
  const defView = views.find((v) => v.def);
  const [f, setF] = useState<ViewFilters>(() => fromLink ? { ...empty, city: initial.city ?? [], cluster: initial.cluster ?? [], prop: initial.prop ?? [], role: l0("role"), asg: l0("asg"), cbm: l0("cbm"), rv: l0("rv"), mine: g0("mine") === "1" } : defView ? { ...empty, ...(defView.f as Partial<ViewFilters>) } : empty);
  const dates0: Record<string, [string, string]> = { yday: [addDays(today, -1), addDays(today, -1)], "7d": [addDays(today, -6), today] };
  const [date, setDateMode] = useState(initial.from ? "custom" : d0 && dates0[d0] ? d0 : "today");
  const [from, setFrom] = useState(initial.from ?? (d0 && dates0[d0] ? dates0[d0][0] : today));
  const [to, setTo] = useState(initial.to ?? (d0 && dates0[d0] ? dates0[d0][1] : today));
  const [tab, setTab] = useState(initial.tab ?? "review");
  const [bk, setBk] = useState(initial.bucket ?? (initial.over ? "over" : "all"));
  const [q, setQ] = useState(g0("q") ?? "");
  const [sort, setSort] = useState<SortState>(sort0 ? { key: sort0.replace(/[.-]1$/, ""), dir: sort0.endsWith("-1") ? -1 : 1 } : null);
  const [page, setPage] = useState(Math.max(0, Number(g0("pg") ?? 1) - 1) || 0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(g0("open") ? Number(g0("open")) : null);
  useEffect(() => {
    const j = (l: string[]) => (l.length ? l.join("|") : null);
    writeUrl({ tab: tab === "review" ? null : tab, bucket: bk === "all" ? null : bk, over: null,
      d: date === "today" || date === "custom" ? null : date, from: date === "custom" ? from : null, to: date === "custom" ? to : null,
      city: j(f.city), cluster: j(f.cluster), prop: j(f.prop), role: j(f.role), asg: j(f.asg), cbm: j(f.cbm), rv: j(f.rv), mine: f.mine ? "1" : null,
      q: q || null, pg: page ? String(page + 1) : null, sort: sort ? `${sort.key}${sort.dir === -1 ? "-1" : ".1"}` : null, open: open === null ? null : String(open) });
  }, [tab, bk, date, from, to, f, q, page, sort, open]);
  // Opening one row's ⋯ menu works on that row only, so any ticked rows are let go.
  useClearOnRowMenu(() => setSel(new Set()));
  const [pop, setPop] = useState<string | null>(null);
  const [modal, setModal] = useState<"reassign" | null>(null);
  const [toast, setToast] = useState("");
  // Nobody reminds themselves; reviewers and auditors remind the people doing the task, and only an admin chases another reviewer or auditor.
  const canRemind = (t: QItem, who: string | null | undefined) => !!who && who !== me && (isAdmin || ["upcoming", "current", "notsub", "changes", "auditflag"].includes(t.s));
  const [hist, setHist] = useState<Ev[]>([]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (pop) setPop(null); else if (modal) setModal(null); else setOpen(null); };
    const onClick = () => setPop(null);
    document.addEventListener("keydown", onKey); document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [pop, modal]);
  // Clicking a task goes straight to its review sheet; Ctrl/⌘-click opens it in a new tab. Details stay in the row menu.
  const openSheet = (id: number, newTab = false) => { if (newTab) window.open(`/review/${id}`, "_blank"); else router.push(`/review/${id}`); };
  useEffect(() => { if (open !== null) getHistory(open).then(setHist, () => setHist([])); }, [open]);

  const setDate = (d: string) => {
    setDateMode(d);
    if (d === "today") { setFrom(today); setTo(today); }
    else if (d === "yday") { setFrom(addDays(today, -1)); setTo(addDays(today, -1)); }
    else if (d === "7d") { setFrom(addDays(today, -6)); setTo(today); }
  };
  const change = (patch: Partial<ViewFilters>) => { setF((x) => prune({ ...x, ...patch })); setPage(0); };

  // City → Cluster → Property: each column narrows the next.
  const cities = useMemo(() => [...new Set(geo.map((g) => g.city))].map((c) => ({ v: c, n: geo.filter((g) => g.city === c).length })), [geo]);
  const clusterList = (ff = f) => [...new Map(geo.filter((g) => !ff.city.length || ff.city.includes(g.city)).map((g) => [g.cluster, { g: g.city, v: g.cluster, n: geo.filter((x) => x.cluster === g.cluster).length }])).values()];
  const propList = (ff = f) => geo.filter((g) => (!ff.city.length || ff.city.includes(g.city)) && (!ff.cluster.length || ff.cluster.includes(g.cluster))).map((g) => ({ g: g.cluster, v: g.property }));
  function prune(x: ViewFilters): ViewFilters {
    const cl = clusterList(x).map((c) => c.v); const c2 = { ...x, cluster: x.cluster.filter((v) => cl.includes(v)) };
    const pl = propList(c2).map((p) => p.v); return { ...c2, prop: c2.prop.filter((v) => pl.includes(v)) };
  }
  const uniq = (l: string[]) => [...new Set(l.filter(Boolean))].sort();
  const people = useMemo(() => uniq(items.map((i) => i.a)), [items]);
  const cbmList = useMemo(() => uniq(items.map((i) => i.cbm)), [items]);
  // Reviewers and auditors: the central team.
  const central = useMemo(() => uniq(items.flatMap((i) => [i.rv, i.au])), [items]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);

  const inScope = (t: QItem) =>
    (!f.city.length || f.city.includes(t.city)) && (!f.cluster.length || f.cluster.includes(t.cluster)) && (!f.prop.length || f.prop.includes(t.p)) &&
    (!f.role.length || f.role.includes(t.r)) && (!f.asg.length || f.asg.includes(t.a)) && (!f.mine || t.mine) &&
    (!f.cbm?.length || f.cbm.includes(t.cbm)) && (!f.rv?.length || f.rv.includes(t.rv) || f.rv.includes(t.au)) &&
    words.every((w) => `${t.t} ${t.p} ${t.cluster} ${t.city} ${t.a} ${t.cbm} ${t.rv} ${t.au} ${t.next}`.toLowerCase().includes(w));
  const inDates = (t: QItem) => t.date >= from && t.date <= to;
  // Weekend and Auto-closed ignore the date filter: they are whatever is waiting from the days off, however old.
  const tasksFor = (k: string) => items.filter((t) => inScope(t) && (
    k === "weekend" ? isWeekend(t) : k === "wkclosed" ? !!t.pull
      : t.s === k && inDates(t) && !(isCentral && isWeekend(t) && (k === "review" || k === "resub"))));

  const g = grpOf(tab);
  const all = tasksFor(tab);
  const cnt = { all: all.length, r: 0, a: 0, g: 0, over: all.filter(over).length } as Record<string, number>;
  all.forEach((t) => cnt[bucket(t)]++);
  let list = g.open && bk !== "all" ? all.filter((t) => (bk === "over" ? over(t) : bk === "must" || bk === "auto" ? t.wk === bk : bucket(t) === bk)) : all;
  list = sort ? sortRows(list, sort, (t, k) => k === "task" ? t.t : k === "asg" ? t.a : k === "next" ? t.next || nextStep(t).what : k === "sched" ? t.schedAt : k === "last" ? t.lastAt : k === "wait" ? (g.open ? t.h : t.date) : null)
    : [...list].sort((a, b) => tab === "weekend" ? (a.wk === b.wk ? (a.wkClose ?? 0) - (b.wkClose ?? 0) : a.wk === "must" ? -1 : 1)
      : tab === "wkclosed" ? (b.wkClosedAt ?? 0) - (a.wkClosedAt ?? 0) : g.open ? b.h - a.h : b.date.localeCompare(a.date));
  const [size, setSize] = usePageSize();
  const pg = clampPage(page, list.length, size);
  const shown = list.slice(pg * size, pg * size + size);
  const [hidden, toggleCol] = useHiddenCols("Review Queue");
  const on = (k: string) => !hidden.has(k);
  const vis = QCOLS.filter((c) => on(c.key));
  const grid = { "--qcols": ["28px", "minmax(0,2fr)", ...vis.map((c) => c.w), "36px"].join(" ") } as React.CSSProperties;
  const header = ["Task", "Property", "City", "Cluster", "Critical", "Attempt", ...(on("asg") ? ["Assignee", "Role"] : []), ...(on("sched") ? ["Scheduled", "Window"] : []),
    ...(on("last") ? ["Last action", "Last action at"] : []), ...(on("next") ? ["Next step"] : []), ...(on("wait") ? [g.open ? "Waiting (hours)" : "Date"] : [])];
  const cells = (l: QItem[]) => l.map((t) => { const n = nextStep(t); return [t.t, t.p, t.city, t.cluster, t.crit ? "Yes" : "", t.att,
    ...(on("asg") ? [t.a, t.r] : []), ...(on("sched") ? [fmtDate(t.date), t.win] : []), ...(on("last") ? [t.lastL, t.lastAt ? fmtDateTime(t.lastAt) : ""] : []),
    ...(on("next") ? [`${n.who ? n.who + " " : ""}${n.what}`] : []), ...(on("wait") ? [g.open ? t.h : fmtDate(t.date)] : [])]; });
  const hiddenByDate = items.filter((t) => t.s === tab && inScope(t) && !inDates(t)).length;
  const hiddenByFilter = items.filter((t) => t.s === tab && inDates(t)).length - all.length;
  const oldest = list.length && g.open ? Math.max(...list.map((t) => t.h)) : 0;

  const locText = f.prop.length ? (f.prop.length === 1 ? f.prop[0] : f.prop.length + " properties") : f.cluster.length ? (f.cluster.length === 1 ? f.cluster[0] : f.cluster.length + " clusters") : f.city.length ? (f.city.length === 1 ? f.city[0] : f.city.length + " cities") : "All properties";

  function nextStep(t: QItem) {
    if (isWeekend(t)) return t.wk === "must"
      ? { who: t.next, what: "to check", sub: <>Weekend · {t.wkWhy}</> }
      : { who: "", what: "Optional check", sub: <>Closes by itself {fmtDateTime(t.wkClose!)}</> };
    if (t.wkClosedAt && t.s === "done") return { who: "", what: "Closed by weekend sampling", sub: t.pull ? <>Can be pulled back until {fmtDateTime(t.wkClosedAt + pullbackDays * 86_400_000)}</> : <>Not checked by hand</> };
    if (t.s === "review" || t.s === "resub") return { who: t.next, what: "to review", sub: over(t) ? <span className="warn">Was due {fmtH(t.h - t.sla)} ago</span> : <>Due in {fmtH(t.sla - t.h)}</> };
    if (t.s === "audit") return { who: t.next, what: "to audit", sub: over(t) ? <span className="warn">Was due {fmtH(t.h - t.sla)} ago</span> : <>Due in {fmtH(t.sla - t.h)}</> };
    if (t.s === "flagans") return { who: t.next, what: "to close flags", sub: <>CBM answered the audit flags</> };
    if (t.s === "auditflag") return { who: t.next, what: "to answer audit flags", sub: <>“{t.why}”</> };
    if (t.s === "changes") return { who: t.next, what: "to fix", sub: <>“{t.why}”{t.last && <> · <span className="warn">last attempt</span></>}</> };
    if (t.s === "notsub") return { who: t.next, what: "to submit", sub: <>Window {t.win}{t.h >= 24 && <> · <span className="warn">in late window</span></>}</> };
    if (t.s === "done") return { who: "", what: "Verified", sub: <>by {t.au && t.rv ? `${t.rv}, audited by ${t.au}` : t.rv || "reviewer"}</> };
    if (t.s === "notrect") return { who: "", what: "Not rectified", sub: <>Attempts used up</> };
    if (t.s === "waived") return { who: "", what: "Waived", sub: <>Not counted</> };
    return { who: "", what: "Missed", sub: <>Window closed unsubmitted</> };
  }
  function Age({ t }: { t: QItem }) {
    if (isWeekend(t) && t.wk === "auto") return <div className="age"><div className="l"><span>Optional</span><span /></div><small>Closes {fmtDateTime(t.wkClose!)}</small></div>;
    if (tab === "wkclosed" && t.wkClosedAt) return <div className="age"><div className="l"><span>{fmtDateTime(t.wkClosedAt)}</span><span /></div><small>{t.pull ? "Can pull back" : "Window passed"}</small></div>;
    if (!grpOf(t.s).open) return <div className="age"><div className="l"><span>{nice(t.date)}</span><span /></div></div>;
    const lim = t.sla || 24, pct = Math.min(100, (t.h / lim) * 100), cls = t.sla ? (t.h > t.sla ? "r" : t.h > t.sla * 0.75 ? "a" : "") : t.h >= 24 ? "r" : "a";
    return (
      <div className="age">
        <div className="l"><span>{fmtH(t.h)}</span><span>{t.sla ? `SLA ${t.sla}h` : "since window"}</span></div>
        <div className="meter"><i className={cls} style={{ width: pct + "%" }} /></div>
        {over(t) ? <small className="r">Over by {fmtH(t.h - t.sla)}</small> : <small>{t.sla ? "Within SLA" : "Not submitted"}</small>}
      </div>
    );
  }

  const chips: [keyof ViewFilters, string, string, string?][] = [
    ...f.city.map((v) => ["city", v, "City"] as [keyof ViewFilters, string, string]), ...f.cluster.map((v) => ["cluster", v, "Cluster"] as [keyof ViewFilters, string, string]),
    ...f.prop.map((v) => ["prop", v, "Property"] as [keyof ViewFilters, string, string]), ...f.role.map((v) => ["role", v, "Role", RNAME[v]] as [keyof ViewFilters, string, string, string]),
    ...f.asg.map((v) => ["asg", v, "Assignee"] as [keyof ViewFilters, string, string]),
    ...(f.cbm ?? []).map((v) => ["cbm", v, "CBM"] as [keyof ViewFilters, string, string]),
    ...(f.rv ?? []).map((v) => ["rv", v, "Reviewer"] as [keyof ViewFilters, string, string]),
  ];
  const chipList: ActiveChip[] = [
    ...chips.map(([k, v, l, d]) => ({ key: k + v, label: <>{l}: <b>{d ?? v}</b></>, clear: () => change({ [k]: (f[k] as string[]).filter((x) => x !== v) }) })),
    ...(f.mine ? [{ key: "mine", label: <>Waiting on me</>, clear: () => change({ mine: false }) }] : []),
  ];
  const openItem = items.find((t) => t.id === open);
  const selIds = [...sel];

  async function pullBack(id: number) {
    const r = await pullBackTask(id);
    setToast(r.ok ? r.msg ?? "Back in review" : r.error); if (r.ok) { setOpen(null); router.refresh(); }
  }
  async function remind(ids: number[]) {
    const r = await remindTasks(ids);
    setToast(r.ok ? r.msg ?? "Done" : r.error); setSel(new Set());
  }

  return (
    <div className="page" style={{ paddingTop: 16 }}>
      <div>
        <main className="q">
          <div className="phead">
            <div><h1>{tabName(tab)}</h1>
            <p className="phead-sub">{locText} · {from === to ? nice(from) : `${nice(from)} – ${nice(to)}`}</p></div>
          </div>
          <nav className="qtabs" aria-label="Queue navigation">
            {GROUPS.map((gr) => (
              <div key={gr.n} className="qgrp" role="group" aria-label={gr.n} style={{ "--gc": gr.c } as React.CSSProperties}>
                <span className="qgrp-l" title={gr.n}>{gr.short}</span>
                <div className="qgrp-b">{gr.tabs.filter(([k]) => isCentral || !CENTRAL_TABS.includes(k)).map(([k, label]) => {
                  const l = tasksFor(k); const hot = l.filter(over).length;
                  return (
                    <button key={k} type="button" className={`qpill${hot ? " hot" : ""}`} aria-current={tab === k} onClick={() => { setTab(k); setBk("all"); setSel(new Set()); setPage(0); }}
                      title={hot ? `${hot} over SLA` : undefined}>
                      {label}<span className="qn">{l.length}</span>
                    </button>
                  );
                })}</div>
              </div>
            ))}
          </nav>

          <FilterBar datesRight search={q} setSearch={(v) => { setQ(v); setPage(0); }} searchLabel="Search task, property or person" chips={chipList}
            onClearAll={() => change(empty)}
            dates={<DateRow value={date} from={from} to={to} max={today} onPick={(k) => { setDate(k); setPage(0); }} onCustom={(a, b) => { setDateMode("custom"); setFrom(a); setTo(b); setPage(0); }} />}
            saved={{ page: "queue", views, current: f, apply: (v) => { setF({ ...empty, ...(v as Partial<ViewFilters>) }); setDate("today"); setSel(new Set()); setPage(0); },
              name: locText + (f.role.length ? " · " + f.role.join(", ") : ""), notify: setToast, note: "Dates are not saved. The queue always starts at today." }}
            panel={<>
              <Field label="Location" wide><LocPicker f={f} cities={cities} clusters={clusterList()} props={propList()} change={change} /></Field>
              <Field label="Role"><div className="checks">{ROLES.map((r) => <label key={r} title={RNAME[r]}><input type="checkbox" checked={f.role.includes(r)} onChange={(e) => change({ role: e.target.checked ? [...f.role, r] : f.role.filter((x) => x !== r) })} />{r}</label>)}</div></Field>
              <Field label="Assignee"><SearchPick multi onChange={(v) => change({ asg: [...f.asg, v] })} placeholder={f.asg.length ? `${f.asg.length} picked · add another` : "Type a name"} options={people.filter((p) => !f.asg.includes(p)).map((v) => ({ v }))} /></Field>
              <Field label="CBM"><SearchPick multi onChange={(v) => change({ cbm: [...(f.cbm ?? []), v] })} placeholder={f.cbm?.length ? `${f.cbm.length} picked · add another` : "Type a CBM name"} options={cbmList.filter((p) => !f.cbm?.includes(p)).map((v) => ({ v }))} /></Field>
              <Field label="Reviewer or auditor"><SearchPick multi onChange={(v) => change({ rv: [...(f.rv ?? []), v] })} placeholder={f.rv?.length ? `${f.rv.length} picked · add another` : "Type a name"} options={central.filter((p) => !f.rv?.includes(p)).map((v) => ({ v }))} /></Field>
              <Field label="Next step"><label className="switch"><input type="checkbox" checked={f.mine} onChange={(e) => change({ mine: e.target.checked })} /> Waiting on me</label></Field>
            </>} />

          <Stats compact items={tab === "weekend" ? [
            { key: "all", label: "Weekend tasks", value: cnt.all, sub: "submitted on days off", active: bk === "all", onClick: () => { setBk("all"); setPage(0); } },
            { key: "must", label: "Must check", value: all.filter((t) => t.wk === "must").length, tone: all.some((t) => t.wk === "must" && over(t)) ? "r" : undefined, sub: "critical, flagged or sampled", active: bk === "must", onClick: () => { setBk("must"); setPage(0); } },
            { key: "auto", label: "Optional", value: all.filter((t) => t.wk === "auto").length, sub: "close by themselves", active: bk === "auto", onClick: () => { setBk("auto"); setPage(0); } },
            { key: "over", label: "Over SLA", value: cnt.over, tone: cnt.over ? "r" : undefined, sub: "days off not counted", active: bk === "over", onClick: () => { setBk("over"); setPage(0); } },
          ] : tab === "wkclosed" ? [
            { key: "all", label: "Auto-closed", value: cnt.all, sub: `can be pulled back for ${pullbackDays} days` },
            { key: "crit", label: "Critical", value: all.filter((t) => t.crit).length },
            { key: "props", label: "Properties", value: new Set(all.map((t) => t.p)).size },
          ] : g.open ? [
            { key: "all", label: "Tasks", value: cnt.all, sub: oldest ? `oldest waiting ${fmtH(oldest)}` : "none waiting", active: bk === "all", onClick: () => { setBk("all"); setPage(0); } },
            { key: "over", label: "Over SLA", value: cnt.over, tone: cnt.over ? "r" : undefined, sub: "past the time limit", active: bk === "over", onClick: () => { setBk("over"); setPage(0); } },
            { key: "r", label: "Waiting 3+ days", value: cnt.r, tone: cnt.r ? "r" : undefined, active: bk === "r", onClick: () => { setBk("r"); setPage(0); } },
            { key: "a", label: "Waiting 1–3 days", value: cnt.a, tone: cnt.a ? "a" : undefined, active: bk === "a", onClick: () => { setBk("a"); setPage(0); } },
            { key: "g", label: "Under 1 day", value: cnt.g, active: bk === "g", onClick: () => { setBk("g"); setPage(0); } },
          ] : [
            { key: "all", label: "Tasks", value: cnt.all, sub: from === to ? nice(from) : `${nice(from)} – ${nice(to)}` },
            { key: "crit", label: "Critical", value: all.filter((t) => t.crit).length, tone: all.some((t) => t.crit) ? "r" : undefined },
            { key: "props", label: "Properties", value: new Set(all.map((t) => t.p)).size },
          ]} />

          <section className="listcard" aria-label="Tasks" style={grid}>
            <div className="ttool"><span className="small muted">{list.length} task{list.length === 1 ? "" : "s"}</span><span className="spacer" />
              <ColumnsMenu cols={[{ key: "task", label: "Task", fixed: true }, ...QCOLS.map((c) => c.key === "wait" && !g.open ? { ...c, label: "Date" } : c)]} hidden={hidden} toggle={toggleCol} />
              <ExportMenu name={`Review Queue ${tabName(tab)}`} header={header} rows={() => cells(list)} page={list.length > shown.length ? () => cells(shown) : undefined} /></div>
            {sel.size > 0 && (
              <div className="bulk">
                <span>{sel.size} selected</span><span className="spacer" />
                <button type="button" className="btn sm primary" onClick={() => remind(selIds)}>Send reminder</button>
                {isAdmin && ["review", "resub"].includes(tab) && <button type="button" className="btn sm" onClick={() => setModal("reassign")}>Reassign reviewer</button>}
                <button type="button" className="btn sm" onClick={() => setSel(new Set())}>Clear</button>
              </div>
            )}
            <div className="lhead">
              <span><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((t) => sel.has(t.id))}
                onChange={(e) => setSel(e.target.checked ? new Set(shown.map((t) => t.id)) : new Set())} /></span>
              <SortHead k="task" label="Task" sort={sort} setSort={(x) => { setSort(x); setPage(0); }} />
              {vis.map((c) => <SortHead key={c.key} k={c.key} label={c.key === "wait" && !g.open ? "Date" : c.label} sort={sort} setSort={(x) => { setSort(x); setPage(0); }} />)}<span />
            </div>
            {!list.length ? (
              <div className="empty">
                <b>Nothing waiting here</b>
                {hiddenByDate > 0 && <>{hiddenByDate} older task{hiddenByDate > 1 ? "s are" : " is"} outside these dates. <button type="button" className="link" onClick={() => { setDateMode("custom"); setFrom(addDays(today, -30)); setTo(today); }}>Show last 30 days</button><br /></>}
                {hiddenByFilter > 0 && <>{hiddenByFilter} task{hiddenByFilter > 1 ? "s are" : " is"} hidden by your filters. <button type="button" className="link" onClick={() => { change(empty); setQ(""); }}>Clear filters</button></>}
                {!hiddenByDate && !hiddenByFilter && "You are all caught up for this view."}
              </div>
            ) : shown.map((t) => {
              const n = nextStep(t);
              const sev = g.open ? (bucket(t) === "r" ? "var(--red)" : bucket(t) === "a" ? "var(--amber)" : "var(--green)") : "transparent";
              return (
                <div key={t.id}>
                  <div className="qrow" role="group" tabIndex={0} aria-label={`${t.t}, ${t.p}: press Enter to open the review sheet`} data-open={open === t.id || undefined} style={{ ["--sev" as string]: sev }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("input,.rowmenu")) return; openSheet(t.id, e.metaKey || e.ctrlKey); }} onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === "Enter") openSheet(t.id, e.metaKey || e.ctrlKey); }}>
                    <span><input type="checkbox" aria-label="Select" checked={sel.has(t.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(t.id); else s.delete(t.id); setSel(s); }} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="tname">{t.t}{t.crit && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</div>
                      <div className="tsub">{t.p} · {t.city}{t.att ? ` · Attempt ${t.att}` : ""}</div>
                    </div>
                    {on("asg") && <div className="who"><Person name={t.a} sub={t.r} /></div>}
                    {on("sched") && <div className="sch"><span className="mtl">Scheduled </span>{fmtDate(t.date)}<small>{t.win}</small></div>}
                    {on("last") && <div className="lst"><span className="mtl">Last action </span>{t.lastL}<small>{fmtDateTime(t.lastAt)}</small></div>}
                    {on("next") && <div className="next">{n.who ? <><b>{n.who}</b> {n.what}</> : <b>{n.what}</b>}<small>{n.sub}</small></div>}
                    {on("wait") && <Age t={t} />}
                    <RowMenu label={`Actions for ${t.t}`} actions={[
                      { label: "Show details", onClick: () => setOpen(t.id) },
                      { label: "Open review sheet", onClick: () => router.push(`/review/${t.id}`) },
                      { label: "Pull back for review", hidden: !(canReview && t.pull), onClick: () => pullBack(t.id) },
                      { label: `Remind ${n.who?.split(" ")[0]}`, hidden: !g.open || !canRemind(t, n.who), onClick: () => remind([t.id]) },
                      { label: "Escalate…", danger: true, hidden: !canEscalate, onClick: () => router.push(`/escalations?task=${t.id}`) },
                      { label: "Reassign reviewer", hidden: !(isAdmin && ["review", "resub"].includes(t.s)), onClick: () => { setSel(new Set([t.id])); setModal("reassign"); } },
                    ]} />
                  </div>
                </div>
              );
            })}
            <Pager page={pg} total={list.length} size={size} setPage={setPage} setSize={setSize} />
          </section>
        </main>
      </div>

      {openItem && (() => {
        const t = openItem, n = nextStep(t), gr = grpOf(t.s);
        return (
          <>
            <div className="scrim" onClick={() => setOpen(null)} />
            <aside className="drawer" role="dialog" aria-label="Task details">
              <div className="dh">
                <div><h2>{t.t}</h2><p>{t.p} · {t.cluster}, {t.city}</p></div>
                <button type="button" className="x" aria-label="Close" onClick={() => setOpen(null)}>×</button>
              </div>
              <div className="db">
                <div className={`nextbox${over(t) ? " r" : ""}`}>
                  <h4>Next step</h4>
                  <p>{n.who ? `${n.who} ${n.what}` : n.what}</p>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{n.sub}</div>
                  {gr.open && <div style={{ marginTop: 8 }}><Age t={t} /></div>}
                </div>
                <dl className="kv">
                  <dt>Status</dt><dd>{tabName(t.s)}</dd>
                  <dt>Assignee</dt><dd>{t.a} · {t.r}</dd>
                  {t.rv && <><dt>Reviewer</dt><dd>{t.rv}</dd></>}
                  {t.au && <><dt>Auditor</dt><dd>{t.au}</dd></>}
                  <dt>CBM</dt><dd>{t.cbm}</dd>
                  {t.att && <><dt>Attempt</dt><dd>{t.att}</dd></>}
                  <dt>Task date</dt><dd>{nice(t.date)} · {t.win}</dd>
                </dl>
                <div>
                  <h3>History</h3>
                  <ul className="tl">
                    {hist.map((e, i) => {
                      const cls = /missed|changes|failed|warning|reopened/.test(e.type) ? "r" : /passed|closed/.test(e.type) ? "g" : /submit/.test(e.type) ? "b" : e.type === "reminder" ? "a" : "";
                      const gap = i ? e.at - hist[i - 1].at : 0;
                      return <li key={e.id} className={cls}>{gap > 60000 && <span className="dur">+{fmtH(Math.round(gap / 3600000))} · </span>}{e.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}{e.actor ? ` by ${e.actor}` : ""}<small>{fmtDateTime(e.at)}{e.detail ? ` · ${e.detail}` : ""}</small></li>;
                    })}
                  </ul>
                </div>
              </div>
              <div className="df">
                <Link className="btn primary" href={`/review/${t.id}`}>Open review sheet</Link>
                {canReview && t.pull && <button type="button" className="btn" onClick={() => pullBack(t.id)}>Pull back for review</button>}
                {canRemind(t, n.who) && <button type="button" className="btn" onClick={() => remind([t.id])}>Remind {n.who!.split(" ")[0]}</button>}
                {canEscalate && <button type="button" className="btn danger" onClick={() => router.push(`/escalations?task=${t.id}`)}>Escalate</button>}
              </div>
            </aside>
          </>
        );
      })()}

      {modal === "reassign" && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="mcard" role="dialog" aria-label="Reassign reviewer">
            <h2>Reassign {sel.size} task{sel.size > 1 ? "s" : ""} to</h2>
            {reviewers.filter((r) => r.name !== me).map((r) => (
              <button key={r.id} type="button" className="btn" onClick={async () => { const x = await reassignReviewer(selIds, r.id); setModal(null); setSel(new Set()); setToast(x.ok ? `Reassigned to ${r.name}` : x.error); router.refresh(); }}>{r.name}</button>
            ))}
            <div className="row2"><span className="spacer" /><button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button></div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Opts({ list, sel, onToggle, groups }: { list: { v: string; l?: string; n?: number; g?: string }[]; sel: string[]; onToggle: (v: string, on: boolean) => void; groups?: boolean }) {
  let last: string | undefined;
  if (!list.length) return <div className="info" style={{ padding: 8 }}>Pick a city first</div>;
  return (
    <>
      {list.map((o) => {
        const gh = groups && o.g !== last ? <div className="grp-l">{o.g}</div> : null;
        last = o.g;
        return (
          <div key={o.v}>
            {gh}
            <label className="opt"><input type="checkbox" checked={sel.includes(o.v)} onChange={(e) => onToggle(o.v, e.target.checked)} /> <span>{o.l ?? o.v}</span>{o.n ? <small>{o.n}</small> : null}</label>
          </div>
        );
      })}
    </>
  );
}

function LocPicker({ f, cities, clusters, props, change }: {
  f: ViewFilters; cities: { v: string; n: number }[]; clusters: { g: string; v: string; n: number }[]; props: { g: string; v: string }[];
  change: (p: Partial<ViewFilters>) => void;
}) {
  const [q, setQ] = useState("");
  const m = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const tog = (k: "city" | "cluster" | "prop") => (v: string, on: boolean) => change({ [k]: on ? [...f[k], v] : f[k].filter((x) => x !== v) });
  return (
    <div className="locpick">
      <input type="search" placeholder="Search city, cluster or property" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="loc">
        <div className="col"><h4>City <button type="button" onClick={() => change({ city: [] })}>Clear</button></h4><div className="opts"><Opts list={cities.filter((c) => m(c.v))} sel={f.city} onToggle={tog("city")} /></div></div>
        <div className="col"><h4>Cluster <button type="button" onClick={() => change({ cluster: [] })}>Clear</button></h4><div className="opts"><Opts list={clusters.filter((c) => m(c.v))} sel={f.cluster} onToggle={tog("cluster")} groups /></div></div>
        <div className="col"><h4>Property <button type="button" onClick={() => change({ prop: props.map((p) => p.v) })}>Select all</button></h4><div className="opts"><Opts list={props.filter((p) => m(p.v))} sel={f.prop} onToggle={tog("prop")} groups /></div></div>
      </div>
      <span className="info small">Each column narrows the next. Leave a column empty to include all.</span>
    </div>
  );
}
