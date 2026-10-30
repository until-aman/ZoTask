"use client";
// Review Queue, following the Phase 1 mockup: City → Cluster → Property multi-select, dates default to today and
// apply to every tab, saved filters with a default view, status sidebar grouped by who acts next.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getHistory, reassignReviewer, remindTasks, ViewFilters } from "@/app/actions";
import { ActiveChip, DateRow, Field, FilterBar, Pager, clampPage, usePageSize, SavedView, SortHead, SortState, Stats, sortRows } from "@/components/ui/Filters";

export type QItem = {
  id: number; t: string; p: string; cluster: string; city: string; a: string; r: string; s: string; h: number; sla: number; att: string;
  last: boolean; rv: string; au: string; cbm: string; date: string; why: string; win: string; crit: boolean; next: string; mine: boolean;
};
type Geo = { city: string; cluster: string; property: string; id: number };
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
  items: QItem[]; geo: Geo[]; views: SavedView[]; reviewers: { id: number; name: string }[]; me: string; canReview: boolean; today: string;
  initial: { tab?: string; city?: string[]; cluster?: string[]; prop?: string[]; from?: string; to?: string; bucket?: string; over?: boolean };
}) {
  const router = useRouter();
  const fromLink = !!(initial.tab || initial.city || initial.prop || initial.from);
  const defView = views.find((v) => v.def);
  const [f, setF] = useState<ViewFilters>(() => fromLink ? { ...empty, city: initial.city ?? [], cluster: initial.cluster ?? [], prop: initial.prop ?? [] } : defView ? { ...empty, ...(defView.f as Partial<ViewFilters>) } : empty);
  const [date, setDateMode] = useState(initial.from ? "custom" : "today");
  const [from, setFrom] = useState(initial.from ?? today);
  const [to, setTo] = useState(initial.to ?? today);
  const [tab, setTab] = useState(initial.tab ?? "review");
  const [bk, setBk] = useState(initial.bucket ?? (initial.over ? "over" : "all"));
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [pop, setPop] = useState<string | null>(null);
  const [modal, setModal] = useState<"reassign" | null>(null);
  const [toast, setToast] = useState("");
  const [hist, setHist] = useState<Ev[]>([]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (pop) setPop(null); else if (modal) setModal(null); else setOpen(null); };
    const onClick = () => setPop(null);
    document.addEventListener("keydown", onKey); document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [pop, modal]);
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
  list = sort ? sortRows(list, sort, (t, k) => k === "task" ? t.t : k === "asg" ? t.a : k === "next" ? t.next || nextStep(t).what : k === "wait" ? (g.open ? t.h : t.date) : null)
    : [...list].sort((a, b) => (g.open ? b.h - a.h : b.date.localeCompare(a.date)));
  const [size, setSize] = usePageSize();
  const pg = clampPage(page, list.length, size);
  const shown = list.slice(pg * size, pg * size + size);
  const hiddenByDate = items.filter((t) => t.s === tab && inScope(t) && !inDates(t)).length;
  const hiddenByFilter = items.filter((t) => t.s === tab && inDates(t)).length - all.length;
  const oldest = list.length && g.open ? Math.max(...list.map((t) => t.h)) : 0;

  const locText = f.prop.length ? (f.prop.length === 1 ? f.prop[0] : f.prop.length + " properties") : f.cluster.length ? (f.cluster.length === 1 ? f.cluster[0] : f.cluster.length + " clusters") : f.city.length ? (f.city.length === 1 ? f.city[0] : f.city.length + " cities") : "All properties";

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
  const chipList: ActiveChip[] = [
    ...chips.map(([k, v, l, d]) => ({ key: k + v, label: <>{l}: <b>{d ?? v}</b></>, clear: () => change({ [k]: (f[k] as string[]).filter((x) => x !== v) }) })),
    ...(f.mine ? [{ key: "mine", label: <>Waiting on me</>, clear: () => change({ mine: false }) }] : []),
  ];
  const openItem = items.find((t) => t.id === open);
  const selIds = [...sel];

  async function remind(ids: number[]) {
    const r = await remindTasks(ids);
    setToast(r.ok ? r.msg ?? "Done" : r.error); setSel(new Set());
  }

  return (
    <div className="page" style={{ paddingTop: 16 }}>
      <div>
        <main className="q">
          <div>
            <h1>{tabName(tab)}</h1>
            <p className="muted" style={{ margin: "2px 0 0" }}>{locText} · {from === to ? nice(from) : `${nice(from)} – ${nice(to)}`}</p>
          </div>
          <nav className="qtabs" aria-label="Queue navigation">
            {GROUPS.map((gr) => (
              <div key={gr.n} className="qgrp" role="group" aria-label={gr.n}>
                <span className="qgrp-l">{gr.n}</span>
                <div className="qgrp-b">{gr.tabs.map(([k, label]) => {
                  const l = tasksFor(k); const hot = l.filter(over).length;
                  return (
                    <button key={k} type="button" className="si" aria-current={tab === k} onClick={() => { setTab(k); setBk("all"); setSel(new Set()); setPage(0); }}>
                      <span className="dot" style={{ background: gr.c }} />{label}
                      <span className="cnt">{l.length}</span>
                      {hot ? <span className="hot" title="Over SLA">{hot}</span> : null}
                    </button>
                  );
                })}</div>
              </div>
            ))}
          </nav>

          <Stats items={g.open ? [
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

          <FilterBar search={q} setSearch={(v) => { setQ(v); setPage(0); }} searchLabel="Search task or property" chips={chipList}
            onClearAll={() => change(empty)}
            dates={<DateRow value={date} from={from} to={to} max={today} onPick={(k) => { setDate(k); setPage(0); }} onCustom={(a, b) => { setDateMode("custom"); setFrom(a); setTo(b); setPage(0); }} />}
            saved={{ page: "queue", views, current: f, apply: (v) => { setF({ ...empty, ...(v as Partial<ViewFilters>) }); setDate("today"); setSel(new Set()); setPage(0); },
              name: locText + (f.role.length ? " · " + f.role.join(", ") : ""), notify: setToast, note: "Dates are not saved. The queue always starts at today." }}
            panel={<>
              <Field label="Location" wide><LocPicker f={f} cities={cities} clusters={clusterList()} props={propList()} change={change} /></Field>
              <Field label="Role"><div className="checks">{ROLES.map((r) => <label key={r} title={RNAME[r]}><input type="checkbox" checked={f.role.includes(r)} onChange={(e) => change({ role: e.target.checked ? [...f.role, r] : f.role.filter((x) => x !== r) })} />{r}</label>)}</div></Field>
              <Field label="Assignee"><select value="" onChange={(e) => e.target.value && change({ asg: [...f.asg, e.target.value] })}><option value="">{f.asg.length ? `${f.asg.length} picked · add another` : "Anyone"}</option>{people.filter((p) => !f.asg.includes(p)).map((p) => <option key={p}>{p}</option>)}</select></Field>
              <Field label="Next step"><label className="switch"><input type="checkbox" checked={f.mine} onChange={(e) => change({ mine: e.target.checked })} /> Waiting on me</label></Field>
            </>} />

          <section className="listcard" aria-label="Tasks">
            {sel.size > 0 && (
              <div className="bulk">
                <span>{sel.size} selected</span><span className="spacer" />
                <button type="button" className="btn sm primary" onClick={() => remind(selIds)}>Send reminder</button>
                {canReview && ["review", "resub"].includes(tab) && <button type="button" className="btn sm" onClick={() => setModal("reassign")}>Reassign reviewer</button>}
                <button type="button" className="btn sm" onClick={() => setSel(new Set())}>Clear</button>
              </div>
            )}
            <div className="lhead">
              <span><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((t) => sel.has(t.id))}
                onChange={(e) => setSel(e.target.checked ? new Set(shown.map((t) => t.id)) : new Set())} /></span>
              <SortHead k="task" label="Task" sort={sort} setSort={(x) => { setSort(x); setPage(0); }} /><SortHead k="asg" label="Assignee" sort={sort} setSort={(x) => { setSort(x); setPage(0); }} />
              <SortHead k="next" label="Next step" sort={sort} setSort={(x) => { setSort(x); setPage(0); }} /><SortHead k="wait" label={g.open ? "Waiting" : "Date"} sort={sort} setSort={(x) => { setSort(x); setPage(0); }} /><span />
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
                  <div className="qrow" role="button" tabIndex={0} aria-selected={open === t.id} style={{ ["--sev" as string]: sev }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("input")) return; setOpen(t.id); }} onKeyDown={(e) => { if (e.key === "Enter") setOpen(t.id); }}>
                    <span><input type="checkbox" aria-label="Select" checked={sel.has(t.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(t.id); else s.delete(t.id); setSel(s); }} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="tname">{t.t}{t.crit && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</div>
                      <div className="tsub">{t.p} · {t.city}{t.att ? ` · Attempt ${t.att}` : ""}</div>
                    </div>
                    <div className="who">{t.a}<small>{t.r}</small></div>
                    <div className="next">{n.who ? <><b>{n.who}</b> {n.what}</> : <b>{n.what}</b>}<small>{n.sub}</small></div>
                    <Age t={t} />
                    <span className="chev" aria-hidden="true">›</span>
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
