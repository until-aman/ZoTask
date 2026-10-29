// Sample Zolo data plus 14 days of simulated task history, so every screen has something real to show.
import { all, one, run, tx } from "./db";
import {
  AnswerInput, Instance, Item, Template, auditDecision, answerAuditFlags, closeFlagAnswers, createInstance,
  itemsFor, missingEvidence, latestSubmission, logEvent, reviewDecision, submit, waive, REASONS,
} from "./engine";
import { DAY, HOUR, addDays, atTime, isoDate, weekday } from "./time";

const GEO: Record<string, Record<string, [string, number, number][]>> = {
  Bangalore: {
    Koramangala: [["Zolo Euphoria for Men", 12.9352, 77.6245], ["Zolo Sheldon's Spot for Men", 12.9279, 77.6271], ["Zolo Arcadia", 12.9338, 77.6142]],
    "HSR Layout": [["Zolo Nest HSR", 12.9116, 77.6474], ["Zolo Crest", 12.9081, 77.6409]],
    Whitefield: [["Zolo Aspire", 12.9698, 77.75], ["Zolo Stays Whitefield", 12.9784, 77.7408]],
  },
  Hyderabad: {
    Gachibowli: [["Zolo Orchid", 17.4401, 78.3489], ["Zolo Summit", 17.4435, 78.3772]],
    Madhapur: [["Zolo Hitech", 17.4483, 78.3915]],
  },
  Pune: { Hinjewadi: [["Zolo Harmony", 18.5913, 73.7389], ["Zolo Vista", 18.5975, 73.7176]] },
  Chennai: { OMR: [["Zolo Marina", 12.9165, 80.2296], ["Zolo Coastline", 12.8996, 80.2273]] },
};
const CBMS: Record<string, string> = {
  Koramangala: "Aman Antil", "HSR Layout": "Rashi Renwal", Whitefield: "Rashi Renwal",
  Gachibowli: "Sandeep Rao", Madhapur: "Sandeep Rao", Hinjewadi: "Meera Kulkarni", OMR: "Arun Kumar",
};
const FIRST = ["Ravi", "Lakshmi", "Suresh", "Anita", "Manoj", "Deepa", "Kiran", "Pooja", "Vijay", "Sneha", "Rahul", "Divya", "Ganesh", "Kavitha", "Naveen", "Shalini", "Prakash", "Asha", "Ramesh", "Nisha", "Arjun", "Bhavna", "Mohan", "Rekha", "Sanjay", "Usha", "Tarun", "Geeta", "Imran", "Farah", "Yash", "Jyoti", "Venkat", "Meena", "Harish", "Swati", "Rajesh", "Leela", "Abhay", "Komal", "Dinesh", "Preeti", "Sunil", "Radha"];
const LAST = ["Kumar", "Reddy", "Nair", "Shetty", "Patil", "Iyer", "Gowda", "Sharma", "Das", "Pillai", "Rao", "Joshi"];

type TItem = [label: string, kind: "check" | "number" | "text", photo?: 1, note?: 1];
type TDef = Partial<Template> & { name: string; category: string; op_role: string; items: TItem[]; shortStaysOnly?: boolean };
const TEMPLATES: TDef[] = [
  { name: "HK attendance, grooming and water supply", category: "Housekeeping", op_role: "HK", window_start: "10:00", window_end: "10:30", late_window_days: 0,
    items: [["How many HKs are present?", "number", 1], ["HKs in uniform and groomed", "check", 1], ["Water supply working on all floors", "check"], ["Water tank level (%)", "number"]] },
  { name: "Reception, lift and garbage check", category: "Facilities", op_role: "Reception", window_start: "09:00", window_end: "10:00",
    items: [["Reception desk clean", "check", 1], ["Lift working", "check", 1], ["Garbage cleared from all floors", "check", 1], ["Visitor register updated", "check"]] },
  { name: "Sales calls and lead updates (Morning)", category: "Sales", op_role: "CC", window_start: "10:30", window_end: "12:30", audit_rate: 0.05, geofence: 0,
    items: [["Leads called", "number"], ["CRM updated for every call", "check"], ["Site visits scheduled", "number"]] },
  { name: "New resident meetings", category: "Resident experience", op_role: "CC", window_start: "18:30", window_end: "19:30", audit_rate: 0.1,
    items: [["Meetings held", "number"], ["Welcome kit handed over", "check", 1], ["Resident concerns noted", "text"]] },
  { name: "Property visit and walk", category: "Operations", op_role: "CBM", window_start: "10:00", window_end: "19:00", criticality: "high", review_sla_h: 24, audit_rate: 0.3,
    items: [["Common area photos", "check", 1], ["Pest control certificate checked", "check", 1], ["Resident feedback taken", "text"], ["Issues raised with maintenance", "text", undefined, 1]] },
  { name: "Safety walk", category: "Safety", op_role: "CBM", frequency: "weekly", weekday: 1, window_start: "10:00", window_end: "18:00", criticality: "high", late_window_days: 2, audit_rate: 0.5, audit_sla_h: 72,
    items: [["Fire extinguishers in date", "check", 1], ["Emergency exits clear", "check", 1], ["CCTV working on all floors", "check"], ["First aid kit stocked", "check", 1]] },
  { name: "Model room or bed readiness", category: "Short stays", op_role: "Short stays", trigger: "event", event_name: "Tenant exited", window_start: "10:00", window_end: "14:00", review_sla_h: 8, shortStaysOnly: true,
    items: [["Room cleaned", "check", 1], ["Linen changed", "check", 1], ["Inventory checked", "check"]] },
  { name: "Z Express short-stay check-in readiness", category: "Short stays", op_role: "Short stays", trigger: "event", event_name: "Booking created", window_start: "10:00", window_end: "13:00", review_sla_h: 8, shortStaysOnly: true,
    items: [["Room keys ready", "check"], ["Welcome note placed", "check", 1], ["AC and geyser tested", "check"]] },
];

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed() {
  const R = rng(20261029);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const now = Date.now();
  const today = isoDate(now);

  const userId = (name: string, access: string, op: string | null = null) =>
    Number(run("INSERT INTO users (name, email, access_role, op_role) VALUES (?,?,?,?)", name,
      name.toLowerCase().replace(/[^a-z]+/g, ".") + "@zolostays.com", access, op).lastInsertRowid);

  const ids: Record<string, number> = {};
  const propQuality = new Map<number, number>();
  const shortStayProps: number[] = [];

  tx(() => {
    ids.admin = userId("Ops Admin", "admin");
    for (const n of ["Vankadara Lakshmi Kavya", "Hrithik Singh", "Priya Menon"]) ids[n] = userId(n, "reviewer");
    for (const n of ["Karthick L", "Neeraj"]) ids[n] = userId(n, "auditor");
    for (const n of new Set(Object.values(CBMS))) ids[n] = userId(n, "cbm", "CBM");

    let nameIx = 0;
    const person = () => `${FIRST[nameIx % FIRST.length]} ${LAST[(nameIx++ * 7) % LAST.length]}`;
    let propIx = 0;
    for (const [city, clusters] of Object.entries(GEO)) {
      const cityId = Number(run("INSERT INTO cities (name) VALUES (?)", city).lastInsertRowid);
      for (const [cl, props] of Object.entries(clusters)) {
        const clId = Number(run("INSERT INTO clusters (city_id, name) VALUES (?,?)", cityId, cl).lastInsertRowid);
        for (const [name, lat, lng] of props) {
          const cbm = ids[CBMS[cl]];
          const pid = Number(run("INSERT INTO properties (cluster_id, name, lat, lng, cbm_id) VALUES (?,?,?,?,?)", clId, name, lat, lng, cbm).lastInsertRowid);
          run("INSERT INTO user_properties VALUES (?,?)", cbm, pid);
          // A spread of property quality so rankings and RAG have something to say.
          propQuality.set(pid, [0.92, 0.6, 0.85, 0.75, 0.95, 0.5, 0.88, 0.8, 0.7, 0.9, 0.65, 0.85, 0.78, 0.55][propIx++ % 14]);
          const roles = ["HK", "Reception", "CC"];
          if (propIx % 3 !== 0) { roles.push("Short stays"); shortStayProps.push(pid); }
          for (const r of roles) run("INSERT INTO user_properties VALUES (?,?)", userId(person(), "ground", r), pid);
        }
      }
    }
    const allProps = all<{ id: number }>("SELECT id FROM properties").map((p) => p.id);
    const reviewers = [ids["Vankadara Lakshmi Kavya"], ids["Hrithik Singh"], ids["Priya Menon"]];
    const auditors = [ids["Karthick L"], ids["Neeraj"]];
    TEMPLATES.forEach((t, ix) => {
      const tid = Number(run(
        `INSERT INTO templates (name, category, op_role, trigger, event_name, frequency, weekday, window_start, window_end, review_sla_h, audit_sla_h,
          attempts_allowed, late_window_days, criticality, audit_rate, geofence, reviewer_id, auditor_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.name, t.category, t.op_role, t.trigger ?? "scheduled", t.event_name ?? null, t.frequency ?? "daily", t.weekday ?? null,
        t.window_start, t.window_end, t.review_sla_h ?? 24, t.audit_sla_h ?? 48, t.attempts_allowed ?? 3, t.late_window_days ?? 1,
        t.criticality ?? "normal", t.audit_rate ?? 0.2, t.geofence ?? 1, reviewers[ix % 3], auditors[ix % 2]).lastInsertRowid);
      t.items.forEach(([label, kind, photo, note], pos) =>
        run("INSERT INTO template_items (template_id, pos, label, kind, photo_required, note_required) VALUES (?,?,?,?,?,?)", tid, pos, label, kind, photo ? 1 : 0, note ? 1 : 0));
      for (const p of t.shortStaysOnly ? shortStayProps : allProps) run("INSERT INTO template_properties VALUES (?,?)", tid, p);
    });
  });

  // ---- simulate history ----
  type Act = { at: number; fn: () => void };
  const queue: Act[] = [];
  const push = (at: number, fn: () => void) => { if (at <= now) queue.push({ at, fn }); };
  const templates = all<Template>("SELECT * FROM templates");
  const items = new Map<number, Item[]>(templates.map((t) => [t.id, itemsFor(t.id)]));
  const cbmOf = new Map(all<{ id: number; cbm_id: number }>("SELECT id, cbm_id FROM properties").map((p) => [p.id, p.cbm_id]));
  const slow = new Map([[ids["Vankadara Lakshmi Kavya"], 2.2], [ids["Hrithik Singh"], 0.8], [ids["Priya Menon"], 1]]);

  const answersFor = (tid: number, q: number, complete: boolean): AnswerInput[] => {
    const its = items.get(tid)!;
    const gap = complete || R() < q ? -1 : Math.floor(R() * its.length);
    return its.map((it, ix) => ({
      itemId: it.id,
      checked: it.kind === "check" ? ix !== gap : true,
      value: it.kind === "number" ? String(it.label.includes("%") ? 40 + Math.floor(R() * 60) : 1 + Math.floor(R() * 8))
        : it.kind === "text" ? pick(["All good", "Two residents asked about Wi-Fi speed", "Leaking tap on 2nd floor reported", "No issues today", "Corridor light replaced"]) : undefined,
      note: it.note_required ? "Raised with maintenance team" : undefined,
      photos: it.photo_required && ix !== gap ? [`sample:${it.label}`] : [],
    }));
  };

  const scheduleReview = (id: number, tid: number, submittedAt: number, q: number) => {
    const inst = one<Instance>("SELECT * FROM instances WHERE id=?", id)!;
    const t = templates.find((x) => x.id === tid)!;
    const reviewer = inst.reviewer_id!;
    const delay = (1 + R() * t.review_sla_h * 1.1) * (slow.get(reviewer) ?? 1) * HOUR;
    push(submittedAt + delay, () => {
      const cur = one<Instance>("SELECT * FROM instances WHERE id=?", id)!;
      if (!["review", "resub"].includes(cur.status)) return;
      const sub = latestSubmission(id)!;
      const missing = missingEvidence(sub.id, tid);
      const at = submittedAt + delay;
      const flagIt = missing.length > 0 || R() > q + 0.1;
      if (flagIt) {
        const it = missing[0] ?? pick(items.get(tid)!);
        const reason = missing.length ? (it.photo_required ? "Photo missing" : "Item not done") : pick(REASONS.slice(1, 5));
        reviewDecision(id, reviewer, "changes", [{ itemId: it.id, reason, comment: reason === "Photo unclear" ? "Retake in daylight" : "" }], "", at, at - 20 * 60000);
        const cur2 = one<Instance>("SELECT status FROM instances WHERE id=?", id)!;
        if (cur2.status === "changes" && R() < 0.85) {
          const rs = at + (1 + R() * 18) * HOUR;
          push(rs, () => {
            const c = one<Instance>("SELECT status FROM instances WHERE id=?", id)!;
            if (c.status !== "changes") return;
            const ans = answersFor(tid, q, R() < 0.8);
            ans.forEach((a) => { if (a.itemId === it.id) a.reply = "Fixed and re-uploaded"; });
            submit(id, sub.submitted_by, ans, { ok: true, distance: 40 }, rs);
            scheduleReview(id, tid, rs, Math.min(1, q + 0.2));
          });
        }
      } else {
        reviewDecision(id, reviewer, "pass", [], "", at, at - 10 * 60000);
        const c = one<Instance>("SELECT status, auditor_id FROM instances WHERE id=?", id)!;
        if (c.status === "audit") {
          const aa = at + (4 + R() * t.audit_sla_h * 1.2) * HOUR;
          push(aa, () => {
            if (one<Instance>("SELECT status FROM instances WHERE id=?", id)!.status !== "audit") return;
            if (R() < 0.22) {
              const it = pick(items.get(tid)!);
              auditDecision(id, c.auditor_id!, "fail", [{ itemId: it.id, reason: pick(["Photo unclear", "Wrong location", "Item not done"]), comment: "Doesn't match site visit" }], "", aa);
              const an = aa + (3 + R() * 30) * HOUR;
              push(an, () => {
                const f = all<{ id: number }>("SELECT f.id FROM review_flags f JOIN reviews r ON r.id=f.review_id WHERE r.instance_id=? AND r.kind='audit' AND f.answer IS NULL", id);
                answerAuditFlags(id, cbmOf.get(inst.property_id)!, Object.fromEntries(f.map((x) => [x.id, "Re-checked with team, corrected on site"])), an);
                const cl = an + (2 + R() * 20) * HOUR;
                push(cl, () => closeFlagAnswers(id, c.auditor_id!, true, cl));
              });
            } else auditDecision(id, c.auditor_id!, "pass", [], "", aa);
          });
        }
      }
    });
  };

  const start = addDays(today, -14);
  for (let d = start; d <= addDays(today, 1); d = addDays(d, 1)) {
    for (const t of templates) {
      const props = all<{ property_id: number }>("SELECT property_id FROM template_properties WHERE template_id=?", t.id).map((p) => p.property_id);
      if (t.trigger === "event") {
        // A couple of check-outs/bookings per day across short-stay properties.
        if (d > today) continue;
        for (const p of props) {
          if (R() > 0.25) continue;
          const at = atTime(d, `${String(9 + Math.floor(R() * 8)).padStart(2, "0")}:${pick(["05", "20", "40"])}`);
          if (at > now) continue;
          const id = createInstance(t, p, d, `event:${at}`, at);
          if (id) { logEvent(id, at, null, "triggered", t.event_name!); planSubmit(id, t, p); }
        }
        continue;
      }
      if (t.frequency === "weekly" && weekday(d) !== (t.weekday ?? 1)) continue;
      for (const p of props) {
        const ws = atTime(d, t.window_start);
        const id = createInstance(t, p, d, "schedule", Math.min(now, ws));
        if (id) planSubmit(id, t, p);
      }
    }
  }

  function planSubmit(id: number, t: Template, p: number) {
    const inst = one<Instance>("SELECT * FROM instances WHERE id=?", id)!;
    const q = propQuality.get(p)!;
    const r = R();
    const len = inst.window_end_at - inst.window_start_at;
    if (r < 0.02) { push(inst.window_start_at + 5 * 60000, () => { try { waive(id, ids.admin, "Property under renovation", inst.window_start_at + 5 * 60000); } catch {} }); return; }
    let at: number;
    if (r < q) at = inst.window_start_at + R() * len;                                     // on time
    else if (r < q + (1 - q) * 0.55) at = inst.window_end_at + R() * Math.min(inst.late_until_at - inst.window_end_at, 20 * HOUR); // late
    else {
      if (R() < 0.5) push(inst.window_end_at + 2 * HOUR, () => logEvent(id, inst.window_end_at + 2 * HOUR, cbmOf.get(p)!, "reminder", "Reminder sent to assignee"));
      return;                                                                            // never submitted
    }
    push(at, () => {
      const cur = one<Instance>("SELECT status FROM instances WHERE id=?", id)!;
      if (!["current", "notsub"].includes(cur.status)) return;
      submit(id, inst.assignee_id!, answersFor(t.id, q, false), { ok: R() < 0.95, distance: R() < 0.95 ? Math.floor(R() * 150) : 600 + Math.floor(R() * 2000) }, at);
      scheduleReview(id, t.id, at, q);
    });
  }

  // Run everything in time order, applying time-based transitions before each step.
  // Earliest moment any time-based move can happen; skips the scans between boundaries.
  let nextBoundary = -Infinity;
  const transitions = (ts: number) => {
    if (ts < nextBoundary) return;
    for (const i of all<Instance>("SELECT * FROM instances WHERE status='upcoming' AND window_start_at<=?", ts))
      run("UPDATE instances SET status='current', status_since=? WHERE id=?", i.window_start_at, i.id);
    for (const i of all<Instance>("SELECT * FROM instances WHERE status='current' AND window_end_at<=?", ts)) {
      run("UPDATE instances SET status='notsub', status_since=? WHERE id=?", i.window_end_at, i.id);
      logEvent(i.id, i.window_end_at, null, "window_closed", "Now in late window");
    }
    for (const i of all<Instance>("SELECT * FROM instances WHERE status='notsub' AND late_until_at<=?", ts)) {
      run("UPDATE instances SET status='missed', status_since=?, closed_at=? WHERE id=?", i.late_until_at, i.late_until_at, i.id);
      logEvent(i.id, i.late_until_at, null, "missed", "Late window ended unsubmitted");
    }
    nextBoundary = one<{ t: number | null }>(`SELECT min(CASE status WHEN 'upcoming' THEN window_start_at WHEN 'current' THEN window_end_at
      WHEN 'notsub' THEN late_until_at END) t FROM instances WHERE status IN ('upcoming','current','notsub')`)?.t ?? Infinity;
  };
  tx(() => {
    while (queue.length) {
      queue.sort((a, b) => a.at - b.at);
      const a = queue.shift()!;
      transitions(a.at);
      a.fn();
    }
    transitions(now);
    // Saved filters, as in the Review Queue mockup.
    const blr = { city: ["Bangalore"], cluster: [], prop: [], role: [], asg: [], mine: false };
    run("INSERT INTO saved_views (user_id, name, filters, is_default) VALUES (?,?,?,1)", ids["Vankadara Lakshmi Kavya"], "Bangalore", JSON.stringify(blr));
    run("INSERT INTO saved_views (user_id, name, filters, is_default) VALUES (?,?,?,0)", ids["Vankadara Lakshmi Kavya"], "Koramangala · HK",
      JSON.stringify({ ...blr, cluster: ["Koramangala"], role: ["HK"] }));
  });
  void DAY;
}
