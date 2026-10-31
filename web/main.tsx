// Browser build of ZoTask: the same pages, engine and SQL, running on an in-memory SQLite database.
import { Component, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { init } from "./db";
import { RouterCtx } from "./router";
import { Redirect, NotFound } from "./shims/navigation";
import { currentUser, can, User } from "../lib/auth";
import Shell from "../components/Shell";
import Link from "./shims/link";
import Home from "../app/page";
import Login from "../app/login/page";
import MyTasks from "../app/tasks/page";
import TaskPage from "../app/tasks/[id]/page";
import Queue from "../app/queue/page";
import ReviewSheet from "../app/review/[id]/page";
import Dashboard from "../app/dashboard/page";
import Compare from "../app/compare/page";
import EscalationsPage from "../app/escalations/page";
import MapPage from "../app/map/page";
import Admin from "../app/admin/page";
import EditTemplate from "../app/admin/templates/[id]/page";

type PageFn = (p: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }) => Promise<ReactNode> | ReactNode;
const ROUTES: [RegExp, PageFn, string[]][] = [
  [/^\/$/, Home as PageFn, []],
  [/^\/login$/, Login as PageFn, []],
  [/^\/tasks$/, MyTasks as PageFn, []],
  [/^\/tasks\/(\d+)$/, TaskPage as PageFn, ["id"]],
  [/^\/queue$/, Queue as PageFn, []],
  [/^\/review\/(\d+)$/, ReviewSheet as PageFn, ["id"]],
  [/^\/dashboard$/, Dashboard as PageFn, []],
  [/^\/compare$/, Compare as PageFn, []],
  [/^\/escalations$/, EscalationsPage as PageFn, []],
  [/^\/map$/, MapPage as PageFn, []],
  [/^\/admin$/, Admin as PageFn, []],
  [/^\/admin\/templates\/(\w+)$/, EditTemplate as PageFn, ["id"]],
];

// Photo uploads become data URLs kept with the answer.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, initArg?: RequestInit) => {
  if (String(input) === "/api/upload" && initArg?.body instanceof FormData) {
    const f = initArg.body.get("file") as File;
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    return new Response(JSON.stringify({ name: url }), { headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, initArg);
};

class Catch extends Component<{ go: (to: string) => void; children: ReactNode; k: string }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) { return { err }; }
  componentDidCatch(err: unknown) { if (err instanceof Redirect) this.props.go(err.to); }
  componentDidUpdate(prev: { k: string }) { if (prev.k !== this.props.k && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err && !(this.state.err instanceof Redirect)) return <div className="page"><div className="err">Something broke: {String((this.state.err as Error).message)}</div></div>;
    return this.state.err ? null : this.props.children;
  }
}

function App() {
  const [url, setUrl] = useState("/login");
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<ReactNode>(null);
  const [user, setUser] = useState<User | null>(null);
  const go = useCallback((to: string) => { setUrl(to); window.scrollTo(0, 0); }, []);
  const path = url.split("?")[0];
  const router = useMemo(() => ({ path, push: go, replace: go, refresh: () => setTick((t) => t + 1) }), [path, go]);

  useEffect(() => {
    const onRej = (e: PromiseRejectionEvent) => { if (e.reason instanceof Redirect) { e.preventDefault(); go(e.reason.to); } };
    window.addEventListener("unhandledrejection", onRej);
    return () => window.removeEventListener("unhandledrejection", onRej);
  }, [go]);

  useEffect(() => {
    let live = true;
    (async () => {
      const [p, q] = url.split("?");
      const route = ROUTES.find(([re]) => re.test(p));
      try {
        if (!route) throw new NotFound();
        const m = p.match(route[0])!;
        const params = Object.fromEntries(route[2].map((k, i) => [k, m[i + 1]]));
        const sp = Object.fromEntries(new URLSearchParams(q ?? ""));
        const el = await route[1]({ params: Promise.resolve(params), searchParams: Promise.resolve(sp) });
        if (live) { setView(el); setUser(await currentUser()); }
      } catch (e) {
        if (e instanceof Redirect) go(e.to);
        else if (live) setView(<div className="page"><div className="card empty"><b>Page not found</b><Link href="/">Go home</Link></div></div>);
      }
    })();
    return () => { live = false; };
  }, [url, tick, go]);

  const links: [string, string][] = [];
  if (user) {
    if (can.tasks(user)) links.push(["/tasks", "My Tasks"]);
    if (can.queue(user)) links.push(["/queue", "Review Queue"]);
    if (can.dashboard(user)) links.push(["/dashboard", "Review Dashboard"]);
    if (can.dashboard(user)) links.push(["/compare", "Compare"]);
    if (can.dashboard(user)) links.push(["/escalations", "Escalations"]);
    if (can.dashboard(user)) links.push(["/map", "Map"]);
    if (can.admin(user)) links.push(["/admin", "Admin"]);
  }
  return (
    <RouterCtx.Provider value={router}>
      <div className="proto">Prototype on sample data. Everything runs in your browser and resets when you reload. Use “Switch user” to see each role.</div>
      <Shell user={user} links={links}><Catch go={go} k={url + tick}>{view}</Catch></Shell>
    </RouterCtx.Provider>
  );
}

(async () => {
  const root = document.getElementById("root")!;
  try {
    await init((window as unknown as { initSqlJs: Parameters<typeof init>[0] }).initSqlJs);
    createRoot(root).render(<App />);
  } catch (e) {
    root.innerHTML = `<div class="page"><div class="err">ZoTask couldn't start: ${(e as Error).message}</div></div>`;
  }
})();
