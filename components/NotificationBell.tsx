"use client";
// The bell at the top right: reminders and other things waiting on you, with an unread count,
// a list that opens on click, and a pop-up when something new arrives. It checks every 15 seconds
// (and straight away when you come back to the tab), and keeps every open tab in step.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { myNotifications, readNotifications } from "@/app/actions";
import type { Note } from "@/lib/notify";

const POLL = 15_000, POP_MS = 8_000;
const KIND: Record<string, [string, string]> = {
  reminder: ["Reminder", "a"], changes: ["Changes required", "r"], auditflag: ["Audit flags", "r"], escalation: ["Escalation", "r"], assigned: ["Assigned to you", "b"],
};

function ago(now: number, at: number) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const Bell = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState(false);
  const [pops, setPops] = useState<Note[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [perm, setPerm] = useState<string>("unsupported");
  const box = useRef<HTMLDivElement>(null);
  const chan = useRef<BroadcastChannel | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await myNotifications();
      if (!r) return;
      setItems(r.items); setUnread(r.unread); setNow(Date.now());
      if (r.pop.length) {
        setPops((p) => [...r.pop.filter((n) => !p.some((x) => x.id === n.id)), ...p].slice(0, 3));
        chan.current?.postMessage({ t: "sync" });
        // When the tab is in the background, also show a desktop alert if the person allowed it.
        if (document.hidden && "Notification" in window && Notification.permission === "granted")
          for (const n of r.pop) { const d = new Notification(KIND[n.kind]?.[0] ?? "ZoTask", { body: `${n.title}\n${n.body ?? ""}`, tag: `zo-${n.id}` }); d.onclick = () => { window.focus(); if (n.link) router.push(n.link); }; }
      }
    } catch { /* offline or signed out: try again next time */ } finally { busy.current = false; }
  }, [router]);

  useEffect(() => {
    load();
    if ("Notification" in window) setPerm(Notification.permission);
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL);
    const back = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    if ("BroadcastChannel" in window) {
      chan.current = new BroadcastChannel("zotask-notes");
      chan.current.onmessage = (e) => { if (e.data?.t === "sync") load(); if (e.data?.t === "read") setPops([]); };
    }
    return () => { clearInterval(t); window.removeEventListener("focus", back); document.removeEventListener("visibilitychange", back); chan.current?.close(); };
  }, [load]);

  // Pop-ups go away on their own after a few seconds.
  useEffect(() => {
    if (!pops.length) return;
    const t = setTimeout(() => setPops((p) => p.slice(0, -1)), POP_MS);
    return () => clearTimeout(t);
  }, [pops]);

  // Unread count in the tab title, like other apps.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = unread ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [open]);

  const markRead = async (ids: number[] | "all") => {
    setItems((l) => l.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnread((u) => (ids === "all" ? 0 : Math.max(0, u - items.filter((n) => !n.read && ids.includes(n.id)).length)));
    await readNotifications(ids);
    chan.current?.postMessage({ t: "sync" });
  };
  const go = (n: Note) => {
    setOpen(false);
    setPops((p) => p.filter((x) => x.id !== n.id));
    if (!n.read) markRead([n.id]);
    if (n.link) router.push(n.link);
  };
  const askDesktop = async () => { if ("Notification" in window) setPerm(await Notification.requestPermission()); };

  const shown = only ? items.filter((n) => !n.read) : items;
  const row = (n: Note, pop = false) => {
    const [label, tone] = KIND[n.kind] ?? ["Update", ""];
    return (
      <>
        <span className={`nb-ic ${tone}`} aria-hidden="true" />
        <span className="nb-txt">
          <span className="nb-kind">{label}{n.actor && <> from <b>{n.actor}</b></>}<span className="nb-at"> · {ago(now, n.at)}</span></span>
          <span className="nb-title">{n.title}</span>
          {n.body && <span className="nb-body">{n.body}</span>}
        </span>
        {!pop && !n.read && <span className="nb-dot" aria-label="Unread" />}
      </>
    );
  };

  return (
    <div className="nb" ref={box}>
      <button type="button" className={`nb-btn${open ? " on" : ""}`} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => { setOpen(!open); if (!open) { setPops([]); load(); } }}>
        <Bell />
        {unread > 0 && <span className="nb-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notifications">
          <div className="nb-head">
            <b>Notifications</b>
            <span className="spacer" />
            {unread > 0 && <button type="button" className="link small" onClick={() => markRead("all")}>Mark all as read</button>}
          </div>
          <div className="nb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={!only} className={!only ? "on" : ""} onClick={() => setOnly(false)}>All</button>
            <button type="button" role="tab" aria-selected={only} className={only ? "on" : ""} onClick={() => setOnly(true)}>Unread{unread ? ` (${unread})` : ""}</button>
          </div>
          <div className="nb-list">
            {!shown.length ? <div className="nb-empty"><b>{only ? "You're all caught up" : "No notifications yet"}</b><span>Reminders and anything sent back to you will show up here.</span></div>
              : shown.map((n) => (
                <div key={n.id} className={`nb-item${n.read ? "" : " new"}`}>
                  <button type="button" className="nb-open" onClick={() => go(n)}>{row(n)}</button>
                  {!n.read && <button type="button" className="nb-mark" title="Mark as read" aria-label="Mark as read" onClick={() => markRead([n.id])}>✓</button>}
                </div>
              ))}
          </div>
          {perm === "default" && <div className="nb-foot"><button type="button" className="link small" onClick={askDesktop}>Also alert me when ZoTask is in another tab</button></div>}
        </div>
      )}
      {pops.length > 0 && (
        <div className="nb-pops" aria-live="polite">
          {pops.map((n) => (
            <div key={n.id} className="nb-pop" role="status">
              <button type="button" className="nb-open" onClick={() => go(n)}>{row(n, true)}</button>
              <button type="button" className="nb-x" aria-label="Dismiss" onClick={() => setPops((p) => p.filter((x) => x.id !== n.id))}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
