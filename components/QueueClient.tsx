"use client";
// Review Queue, following the Phase 1 mockup: City → Cluster → Property multi-select, dates default to today and
// apply to every tab, saved filters with a default view, status sidebar grouped by who acts next.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteView, getHistory, reassignReviewer, remindTasks, saveView, setDefaultView, ViewFilters } from "@/app/actions";

export type QItem = {
  id: number; t: string; p: string; cluster: string; city: string; a: string; r: string; s: string; h: number; sla: number; att: string;
  last: boolean; rv: string; au: string; cbm: string; date: string; why: string; win: string; crit: boolean; next: string; mine: boolean;
};
type Geo = { city: string; cluster: string; property: string; id: number };
type View = { id: number; name: string; def: boolean; f: ViewFilters };
type Ev = { id: number; at: number; type: string; detail: string; actor: string | null };

const GROUPS = [
  { n: "Waiting on reviewer or auditor", tabs: [["review", "To Review"], ["resub", "Resubmitted"], ["audit", "To Audit"], ["flagans", "Flag Answers"]], open: true, c: "var(--blue)" },
  { n: "Waiting on ground team or CBM", tabs: [["changes", "Changes Required"], ["notsub", "Not Submitted"], ["auditflag", "Audit Flags"]], open: true, ground: true, c: "var(--amber)" },
  { n: "Closed", tabs: [["done", "Done"], ["missed", "Missed"], ["notrect", "Not rectified"], ["waived", "Waived"]], open: false, c: "var(--faint)" },
] as const;
const grpOf = (k: string) => GROUPS.find((g) => g.tabs.some((t) => t[0] === k))!;
const tabName = (k: string) => grpOf(k).tabs.find((t) => t[0] === k)![1];
const ROLES = ["CBM", "HK", "CC", "Reception", "Short stays"];
const RNAME: Record<string, string> = { CBM: "Cluster Business Manager", HK: "Housekeeping Supervisor (HK)", CC: "Customer Care Executive (CC)", Reception: "Front Office / Reception Executive", "Short stays": "Short Stays Operations Executive" };

function addDays(d: string, n: number) { const [y, m, dd] = d.split("-").map(Number); const x = new Date(y, m - 1, dd + n, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; }
const nice = (s: string) => new Date(s + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtH = (h: number) => (h >= 48 ? Math.round(h / 24) + " days" : h + "h");
const over = (t: QItem) => t.sla > 0 && t.h > t.sla;
const bucket = (t: QItem) => (t.h > 72 ? "r" : t.h >= 24 ? "a" : "g");
const empty: ViewFilters = { city: [], cluster: [], prop: [], role: [], asg: [], mine: false };

export default function QueueClient({ items, geo, views, reviewers, me, canReview, today, initial }: {
  items: QItem[]; geo: Geo[]; views: View[]; reviewers: { id: number; name: string }[]; me: string; canReview: boolean; today: string;
  initial: { tab?: string; city?: string[]; cluster?: string[]; prop?: string[]; from?: string; to?: string; bucket?: string; over?: boolean };
}) {
  const router = useRouter();
  const fromLink = !!(initial.tab || initial.city || initial.prop || initial.from);
  const defView = views.find((v) => v.def);
  const [f, setF] = useState<ViewFilters>(() => fromLink ? { ...empty, city: initial.city ?? [], cluster: initial.cluster ?? [], prop: initial.prop ?? [] } : defView ? { ...empty, ...defView.f } : empty);
  const [activeView, setActiveView] = useState<number | null>(fromLink ? null : defView?.id ?? null);
  const [date, setDateMode] = useState(initial.from ? "custom" : "today");
  const [from, setFrom] = useState(initial.from ?? today);
  const [to, setTo] = useState(initial.to ?? today);
  const [tab, setTab] = useState(initial.tab ?? "review");
  const [bk, setBk] = useState(initial.bucket ?? (initial.over ? "over" : "all"));
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("age");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [pop, setPop] = useState<string | null>(null);
  const [modal, setModal] = useState<"save" | "reassign" | null>(null);
  const [toast, setToast] = useState("");
  const [hist, setHist] = useState<Ev[]>([]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (pop) setPop(null); else if (modal) setModal(null); else setOpen(null); };
    const onClick = () => setPop(null);
    document.addEventListener("keydown", onKey); document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [pop, modal]);
  useEffect(() => { if (open !== null) getHistory(open).then(setHist); }, [open]);

  const setDate = (d: string) => {
    setDateMode(d);
    if (d === "today") { setFrom(today); setTo(today); }
    else if (d === "yday") { setFrom(addDays(today, -1)); setTo(addDays(today, -1)); }
    else if (d === "7d") { setFrom(addDays(today, -6)); setTo(today); }
  };
  const change = (patch: Partial<ViewFilters>) => { setF((x) => prune({ ...x, ...patch })); setActiveView(null); };

  // City → Cluster → Property: each column narrows the next.
  const cities = useMemo(() => [...new Set(geo.map((g) => g.city))].map((c) => ({ v: c, n: geo.filter((g) => g.city === c).length })), [geo]);
  const clusterList = (ff = f) => [...new Map(geo.filter((g) => !ff.city.length || ff.city.includes(g.city)).map((g) => [g.cluster, { g: g.city, v: g.cluster, n: geo.filter((x) => x.cluster === g.cluster).length }])).values()];
  const propList = (ff = f) => geo.filter((g) => (!ff.city.length || ff.city.includes(g.city)) && (!ff.cluster.length || ff.cluster.includes(g.cluster))).map((g) => ({ g: g.cluster, v: g.property }));
  function prune(x: ViewFilters): ViewFilters {
    const cl = clusterList(x).map((c) => c.v); const c2 = { ...x, cluster: x.cluster.filter((v) => cl.includes(v)) };
    const pl = propList(c2).map((p) => p.v); return { ...c2, prop: c2.prop.filter((v) => pl.includes(v)) };
  }
  const people = useMemo(() => [...new Set(items.map((i) => i.a))].sort(), [items]);

  const inScope = (t: QItem) =>
    (!f.city.length || f.city.includes(t.city)) && (!f.cluster.length || f.cluster.includes(t.cluster)) && (!f.prop.length || f.prop.includes(t.p)) &&
    (!f.role.length || f.role.includes(t.r)) && (!f.asg.length || f.asg.includes(t.a)) && (!f.mine || t.mine) &&
    (!q || t.t.toLowerCase().includes(q.toLowerCase()) || t.p.toLowerCase().includes(q.toLowerCase()));
  const inDates = (t: QItem) => t.date >= from && t.date <= to;
  const tasksFor = (k: string) => items.filter((t) => t.s === k && inScope(t) && inDates(t));

  const g = grpOf(tab);
  const all = tasksFor(tab);
  const cnt = { all: all.length, r: 0, a: 0, g: 0, over: all.filter(over).length } as Record<string, number>;
  all.forEach((t) => cnt[bucket(t)]++);
  let list = g.open && bk !== "all" ? all.filter((t) => (bk === "over" ? over(t) : bucket(t) === bk)) : all;
  list = [...list].sort((a, b) => sort === "group" ? a.p.localeCompare(b.p) || b.h - a.h : sort === "sla" ? (b.h - b.sla) - (a.h - a.sla) : g.open ? b.h - a.h : b.date.localeCompare(a.date));
  const hiddenByDate = items.filter((t) => t.s === tab && inScope(t) && !inDates(t)).length;
  const hiddenByFilter = items.filter((t) => t.s === tab && inDates(t)).length - all.length;
  const oldest = list.length && g.open ? Math.max(...list.map((t) => t.h)) : 0;

  const locText = f.prop.length ? (f.prop.length === 1 ? f.prop[0] : f.prop.length + " properties") : f.cluster.length ? (f.cluster.length === 1 ? f.cluster[0] : f.cluster.length + " clusters") : f.city.length ? (f.city.length === 1 ? f.city[0] : f.city.length + " cities") : "All properties";
  const summary = (arr: string[], word: string, map?: Record<string, string>) => (arr.length === 0 ? "All" : arr.length === 1 ? (map?.[arr[0]] ?? arr[0]) : arr.length + " " + word);

  function nextStep(t: QItem) {
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
  ];
  const openItem = items.find((t) => t.id === open);
  const selIds = [...sel];

  async function remind(ids: number[]) {
    const r = await remindTasks(ids);
    setToast(r.ok ? r.msg ?? "Done" : r.error); setSel(new Set());
  }

  return (
    <div className="page" style={{ paddingTop: 16 }}>
      <div className="shell">
        <aside className="side" aria-label="Queue navigation">
          <div className="box">
            <h3>My saved filters</h3>
            {views.map((v) => (
              <div key={v.id} className="row2" style={{ gap: 0 }}>
                <button type="button" className="si" style={{ flex: 1 }} aria-current={activeView === v.id}
                  onClick={() => { setF({ ...empty, ...v.f }); setActiveView(v.id); setDate("today"); setSel(new Set()); }}>
                  <span className="star" style={{ visibility: v.def ? "visible" : "hidden" }} title="Opens by default">★</span>{v.name}
                </button>
                {!v.def && <button type="button" className="link small" title="Open with this view every day" onClick={async () => { await setDefaultView(v.id); router.refresh(); }}>☆</button>}
                <button type="button" className="link small" aria-label={`Delete ${v.name}`} onClick={async () => { await deleteView(v.id); router.refresh(); }}>×</button>
              </div>
            ))}
            {!views.length && <p className="small muted" style={{ margin: "0 8px 6px" }}>Save the filters you use every day and the queue opens with them.</p>}
            <button type="button" className="addview" onClick={() => setModal("save")}>+ Save current filters</button>
          </div>
          <div className="box">
            {GROUPS.map((gr) => (
              <div key={gr.n}>
                <h3>{gr.n}</h3>
                {gr.tabs.map(([k, label]) => {
                  const l = tasksFor(k); const hot = l.filter(over).length;
                  return (
                    <button key={k} type="button" className="si" aria-current={tab === k} onClick={() => { setTab(k); setBk("all"); setSel(new Set()); }}>
                      <span className="dot" style={{ background: gr.c }} />{label}
                      {hot ? <span className="cnt"><span className="hot" title="Over SLA">{hot}</span></span> : null}
                      <span className="cnt" style={hot ? { marginLeft: 4 } : undefined}>{l.length}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        <main className="q">
          <div>
            <h1>{tabName(tab)}</h1>
            <p className="muted" style={{ margin: "2px 0 0" }}>
              {list.length} task{list.length === 1 ? "" : "s"}{cnt.over ? <> · <b style={{ color: "var(--red)" }}>{cnt.over} over SLA</b></> : null}
              {oldest ? ` · oldest waiting ${fmtH(oldest)}` : ""} · {locText}
            </p>
          </div>

          <section className="fbar" aria-label="Filters">
            <div className="row2">
              <span style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className={`fbtn${f.city.length || f.cluster.length || f.prop.length ? " set" : ""}`} onClick={() => setPop(pop === "loc" ? null : "loc")}>
                  <span className="k">Location</span><span>{locText}</span>
                </button>
                {pop === "loc" && <LocPop f={f} cities={cities} clusters={clusterList()} props={propList()} change={change} close={() => setPop(null)} />}
              </span>
              <div className="seg" role="group" aria-label="Date range">
                {[["today", "Today"], ["yday", "Yesterday"], ["7d", "7 days"], ["custom", "Custom"]].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={date === k} onClick={() => setDate(k)}>{l}</button>
                ))}
              </div>
              {date === "custom" && <span className="row2"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /> – <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></span>}
              <span style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className={`fbtn${f.role.length ? " set" : ""}`} onClick={() => setPop(pop === "role" ? null : "role")}><span className="k">Role</span><span>{summary(f.role, "roles", RNAME)}</span></button>
                {pop === "role" && <ListPop label="Role" options={ROLES} labels={RNAME} sel={f.role} set={(role) => change({ role })} close={() => setPop(null)} />}
              </span>
              <span style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className={`fbtn${f.asg.length ? " set" : ""}`} onClick={() => setPop(pop === "asg" ? null : "asg")}><span className="k">Assignee</span><span>{summary(f.asg, "people")}</span></button>
                {pop === "asg" && <ListPop label="Assignee" options={people} sel={f.asg} set={(asg) => change({ asg })} close={() => setPop(null)} />}
              </span>
              <input type="search" className="search" placeholder="Search task or property" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
              <label className="switch"><input type="checkbox" checked={f.mine} onChange={(e) => change({ mine: e.target.checked })} /> Waiting on me</label>
            </div>
            <div className="row2">
              <div className="chips">
                {activeView !== null && <span className="using">✓ Using your saved view “{views.find((v) => v.id === activeView)?.name}”</span>}
                {chips.map(([k, v, l, d]) => (
                  <span key={k + v} className="chip">{l}: <b>{d ?? v}</b><button type="button" aria-label={`Remove ${v}`} onClick={() => change({ [k]: (f[k] as string[]).filter((x) => x !== v) })}>×</button></span>
                ))}
                {f.mine && <span className="chip">Waiting on me<button type="button" aria-label="Remove" onClick={() => change({ mine: false })}>×</button></span>}
                {chips.length || f.mine ? <button type="button" className="link" onClick={() => change(empty)}>Clear all</button> : activeView === null && <span className="info">No filters. Showing every property you can access.</span>}
              </div>
              <span className="spacer" />
              {defView && <button type="button" className="link" onClick={() => { setF({ ...empty, ...defView.f }); setActiveView(defView.id); setDate("today"); setToast(`Back to “${defView.name}”`); }}>Reset to my default</button>}
              <button type="button" className="btn outline" onClick={() => setModal("save")}>Save these filters</button>
            </div>
            <div className="info"><i>i</i><span>Dates apply to every tab. Use 7 days or Custom to see older pending work.</span></div>
          </section>

          <section className="listcard" aria-label="Tasks">
            <div className="ltool">
              {g.open ? (
                <div className="bk" role="group" aria-label="Waiting time">
                  {[["all", "All", ""], ["over", "Over SLA", "r"], ["r", "Over 3 days", "r"], ["a", "1–3 days", "a"], ["g", "Under 1 day", "g"]].map(([k, l, c]) => (
                    <button key={k} type="button" aria-pressed={bk === k} onClick={() => setBk(k)}><span className={c}>{l}</span> · {cnt[k]}</button>
                  ))}
                </div>
              ) : <span className="info">{from === to ? nice(from) : `${nice(from)} – ${nice(to)}`}</span>}
              <label className="info" style={{ color: "var(--fg)" }}>Sort
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="age">{g.open ? "Longest waiting first" : "Newest first"}</option><option value="sla">Most over SLA first</option><option value="group">Group by property</option>
                </select>
              </label>
            </div>
            {sel.size > 0 && (
              <div className="bulk">
                <span>{sel.size} selected</span><span className="spacer" />
                <button type="button" className="btn sm primary" onClick={() => remind(selIds)}>Send reminder</button>
                {canReview && ["review", "resub"].includes(tab) && <button type="button" className="btn sm" onClick={() => setModal("reassign")}>Reassign reviewer</button>}
                <button type="button" className="btn sm" onClick={() => setSel(new Set())}>Clear</button>
              </div>
            )}
            <div className="lhead">
              <span><input type="checkbox" aria-label="Select all" checked={list.length > 0 && list.every((t) => sel.has(t.id))}
                onChange={(e) => setSel(e.target.checked ? new Set(list.map((t) => t.id)) : new Set())} /></span>
              <span>Task</span><span>Assignee</span><span>Next step</span><span>{g.open ? "Waiting" : "Date"}</span><span />
            </div>
            {!list.length ? (
              <div className="empty">
                <b>Nothing waiting here</b>
                {hiddenByDate > 0 && <>{hiddenByDate} older task{hiddenByDate > 1 ? "s are" : " is"} outside these dates. <button type="button" className="link" onClick={() => { setDateMode("custom"); setFrom(addDays(today, -30)); setTo(today); }}>Show last 30 days</button><br /></>}
                {hiddenByFilter > 0 && <>{hiddenByFilter} task{hiddenByFilter > 1 ? "s are" : " is"} hidden by your filters. <button type="button" className="link" onClick={() => { change(empty); setQ(""); }}>Clear filters</button></>}
                {!hiddenByDate && !hiddenByFilter && "You are all caught up for this view."}
              </div>
            ) : list.map((t, ix) => {
              const n = nextStep(t);
              const sev = g.open ? (bucket(t) === "r" ? "var(--red)" : bucket(t) === "a" ? "var(--amber)" : "var(--green)") : "transparent";
              const head = sort === "group" && (ix === 0 || list[ix - 1].p !== t.p);
              return (
                <div key={t.id}>
                  {head && <div className="ghead">{t.p}<span>{list.filter((x) => x.p === t.p).length} tasks</span></div>}
                  <div className="qrow" role="button" tabIndex={0} aria-selected={open === t.id} style={{ ["--sev" as string]: sev }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("input")) return; setOpen(t.id); }} onKeyDown={(e) => { if (e.key === "Enter") setOpen(t.id); }}>
                    <span><input type="checkbox" aria-label="Select" checked={sel.has(t.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(t.id); else s.delete(t.id); setSel(s); }} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="tname">{t.t}{t.crit && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</div>
                      <div className="tsub">{sort === "group" ? "" : t.p + " · "}{t.city}{t.att ? ` · Attempt ${t.att}` : ""}</div>
                    </div>
                    <div className="who">{t.a}<small>{t.r}</small></div>
                    <div className="next">{n.who ? <><b>{n.who}</b> {n.what}</> : <b>{n.what}</b>}<small>{n.sub}</small></div>
                    <Age t={t} />
                    <span className="chev" aria-hidden="true">›</span>
                  </div>
                </div>
              );
            })}
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
                  <div style={{ fontSize: 13, marginTop: 2 }}>{n.sub}</div>
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
                      return <li key={e.id} className={cls}>{gap > 60000 && <span className="dur">+{fmtH(Math.round(gap / 3600000))} · </span>}{e.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}{e.actor ? ` by ${e.actor}` : ""}<small>{new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{e.detail ? ` · ${e.detail}` : ""}</small></li>;
                    })}
                  </ul>
                </div>
              </div>
              <div className="df">
                <Link className="btn primary" href={`/review/${t.id}`}>Open review sheet</Link>
                {n.who && <button type="button" className="btn" onClick={() => remind([t.id])}>Remind {n.who.split(" ")[0]}</button>}
              </div>
            </aside>
          </>
        );
      })()}

      {modal === "save" && <SaveModal f={f} locText={locText} close={() => setModal(null)} done={(msg) => { setModal(null); setToast(msg); router.refresh(); }} />}
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

function LocPop({ f, cities, clusters, props, change, close }: {
  f: ViewFilters; cities: { v: string; n: number }[]; clusters: { g: string; v: string; n: number }[]; props: { g: string; v: string }[];
  change: (p: Partial<ViewFilters>) => void; close: () => void;
}) {
  const [q, setQ] = useState("");
  const m = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const tog = (k: "city" | "cluster" | "prop") => (v: string, on: boolean) => change({ [k]: on ? [...f[k], v] : f[k].filter((x) => x !== v) });
  return (
    <div className="pop" role="dialog" aria-label="Location" style={{ width: 640 }}>
      <input type="search" placeholder="Search city, cluster or property" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="loc">
        <div className="col"><h4>City <button type="button" onClick={() => change({ city: [] })}>Clear</button></h4><div className="opts"><Opts list={cities.filter((c) => m(c.v))} sel={f.city} onToggle={tog("city")} /></div></div>
        <div className="col"><h4>Cluster <button type="button" onClick={() => change({ cluster: [] })}>Clear</button></h4><div className="opts"><Opts list={clusters.filter((c) => m(c.v))} sel={f.cluster} onToggle={tog("cluster")} groups /></div></div>
        <div className="col"><h4>Property <button type="button" onClick={() => change({ prop: props.map((p) => p.v) })}>Select all</button></h4><div className="opts"><Opts list={props.filter((p) => m(p.v))} sel={f.prop} onToggle={tog("prop")} groups /></div></div>
      </div>
      <div className="popfoot"><span className="info">Each column narrows the next. Leave a column empty to include all.</span><button type="button" className="btn primary sm" onClick={close}>Done</button></div>
    </div>
  );
}

function ListPop({ label, options, labels, sel, set, close }: { label: string; options: string[]; labels?: Record<string, string>; sel: string[]; set: (v: string[]) => void; close: () => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="pop" role="dialog" aria-label={label} style={{ width: labels ? 340 : 260 }}>
      {options.length > 5 && <input type="search" placeholder={`Search ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="opts">
        <Opts list={options.filter((o) => !q || (labels?.[o] ?? o).toLowerCase().includes(q.toLowerCase())).map((v) => ({ v, l: labels?.[v] }))} sel={sel}
          onToggle={(v, on) => set(on ? [...sel, v] : sel.filter((x) => x !== v))} />
      </div>
      <div className="popfoot"><button type="button" className="link" onClick={() => set([])}>Clear</button><button type="button" className="btn primary sm" onClick={close}>Done</button></div>
    </div>
  );
}

function SaveModal({ f, locText, close, done }: { f: ViewFilters; locText: string; close: () => void; done: (msg: string) => void }) {
  const [name, setName] = useState(locText + (f.role.length ? " · " + f.role.join(", ") : ""));
  const [def, setDef] = useState(true);
  const parts = [locText, ...(f.role.length ? [f.role.join(", ")] : []), ...(f.asg.length ? [f.asg.length + " assignees"] : []), ...(f.mine ? ["waiting on me"] : []), "dates not saved, always start at today"];
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="mcard" role="dialog" aria-label="Save filters">
        <h2>Save these filters</h2>
        <div className="info" style={{ background: "var(--bg)", borderRadius: 8, padding: "8px 10px" }}>{parts.join(" · ")}</div>
        <label className="f">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="row2" style={{ fontWeight: 600 }}><input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} /> Open the queue with these filters every day</label>
        <div className="row2"><span className="spacer" /><button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" onClick={async () => { const r = await saveView(name.trim(), f, def); done(r.ok ? r.msg ?? "Saved" : r.error); }}>Save</button></div>
      </div>
    </div>
  );
}
