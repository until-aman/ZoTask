// Sample Zolo data plus 14 days of simulated task history, so every screen has something real to show.
import { all, one, run, tx } from "./db";
import {
  AnswerInput, Instance, Item, Template, auditDecision, answerAuditFlags, closeFlagAnswers, createInstance,
  itemsFor, list, missingEvidence, latestSubmission, logEvent, reviewDecision, submit, waive, REASONS,
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

// kind "count" checks the answer against the property's ideal HK or SHK headcount.
type TItem = [label: string, kind: "check" | "number" | "text" | "count", photo?: 0 | 1, countOf?: "HK" | "SHK"];
type TDef = Partial<Template> & { name: string; category: string; op_role: string; items: TItem[]; shortStaysOnly?: boolean };
const LEADS: TItem[] = [["Connected with all pending leads (SVs, Magicbricks, inside sales, etc.) till now and updated comments.", "check"]];
const LEAD_LINKS = "Useful links: CRM https://crm.zolostays.com/scheduledVisit · Magicbricks sheet (city-wise): CBM_central_node_workflow_final.xlsx · Inside sales WhatsApp group (city-wise)";
const TICKET_LINKS = "Useful links: R&M Tickets Sheet (Tickets Tracker_CL_RnM & SCAR) · SCAR Sheet (New, Open & Pending Tickets_Live - Coliving)";
const sales = (part: number, start: string, end: string): TDef => ({
  name: `Sales calls and lead updates (Part ${part}/4)`, category: "Sales", op_role: "CBM", window_start: start, window_end: end, geofence: 0, audit_rate: 0.05,
  description: `Complete by ${end}. ${LEAD_LINKS}`, items: LEADS,
});
// The CBM task list ("Zo-Tasks for CBM" sheet). Weekly tasks run on Monday; twice-a-week ones on Monday and Thursday.
const TEMPLATES: TDef[] = [
  { name: "HK attendance and grooming", category: "Housekeeping", op_role: "CBM", window_start: "10:30", window_end: "11:00", geofence: 0,
    description: "Useful link: Staff Roster tab, ACEM Visibility Tracker v2",
    items: [["Connected with the HK/SHK team?", "check"], ["How many SHKs are present?", "count", 0, "SHK"], ["How many HKs are present?", "count", 0, "HK"],
      ["Checked that SHK/HK staff are in uniform and properly dressed. (Share timestamped photo showing all staff together)", "check", 1]] },
  { name: "Water supply updates", category: "Facilities", op_role: "CBM", window_start: "10:30", window_end: "11:00", geofence: 0,
    description: "Useful link: ZoSpend - Water Tanker/Can Form Fills",
    items: [["Have you got the water supply (tanker/can) for the day? Yes/No (If No, state the reason and support required)", "text"],
      ["Have you filled in the water form in the PM app? (If No, state the reason and support required)", "text"]] },
  { name: "Model room or bed readiness", category: "Operations", op_role: "CBM", window_start: "11:30", window_end: "12:00", geofence: 0,
    items: [["Checked the model room or model bed is ready to show. (Enter the Room No.)", "text"]] },
  { name: "Reception, lift and garbage check", category: "Facilities", op_role: "CBM", window_start: "11:30", window_end: "12:00", geofence: 0,
    description: "Useful link: R&M Tickets Sheet (Tickets Tracker_CL_RnM & SCAR)",
    items: [["Checked that reception is clean and dust-free.", "check"], ["Checked that the lift is clean.", "check"],
      ["After how many days is the garbage usually cleared by the vendor?", "number"], ["For how many consecutive days has garbage collection been missed?", "number"]] },
  sales(1, "10:30", "12:30"),
  { name: "Z Express / short-stay check-in readiness", category: "Short stays", op_role: "CBM", window_start: "12:00", window_end: "13:00", geofence: 0, shortStaysOnly: true,
    description: "Useful link: ACEM Visibility Tracker v2",
    items: [["How many short-stay check-ins are expected today?", "number"], ["How many of these rooms are ready?", "number"]] },
  sales(2, "12:30", "14:30"),
  { name: "Property visit and walk", category: "Operations", op_role: "CBM", window_start: "12:00", window_end: "19:30", criticality: "high", audit_rate: 0.3,
    description: "Useful link: SCAR Sheet (New, Open & Pending Tickets_Live - Coliving)",
    items: [["Started the property walk with a staff member. (Upload your timestamped photo with the staff member)", "check", 1],
      ["Checked that reception is clean and dust-free. (Share timestamped photo of reception)", "check", 1],
      ["Is there clutter in reception? Yes/No", "text"],
      ["Checked the lift is clean. (Share timestamped photo of lift)", "check", 1],
      ["Checked the terrace is clean. (Share timestamped photo of terrace)", "check", 1],
      ["Checked the kitchen is clean. (Share timestamped photo of kitchen)", "check", 1],
      ["Checked the model room or model bed is ready to show. (Enter the Room No. and upload a timestamped photo)", "text", 1],
      ["Checked that the bedsheet and pillow are clean and neatly laid on the model bed. (Share timestamped photo of bedsheet and pillow)", "check", 1],
      ["Checked that the washroom is clean. (Share timestamped photo of the model room's washroom)", "check", 1],
      ["Were any issues found? Yes/No (If Yes, elaborate and upload a timestamped photo)", "text", 1]] },
  sales(3, "14:30", "16:30"),
  { name: "New resident meetings", category: "Resident experience", op_role: "CBM", window_start: "10:30", window_end: "19:30", geofence: 0, audit_rate: 0.1,
    description: "Useful links: New residents list tab, ACEM Visibility Tracker v2 · OES responses sheet: Goal Tracking Framework - Live Month",
    items: [["How many residents joined this property in the last 7 days?", "number"],
      ["Of these residents, how many have you met in person and filled the OES form? (Share names of residents)", "text"]] },
  sales(4, "17:00", "19:00"),
  { name: "Central support meeting and ticket updates", category: "Operations", op_role: "CBM", frequency: "weekly", days: "[1,4]", window_start: "10:30", window_end: "19:30", geofence: 0, late_window_days: 1,
    description: TICKET_LINKS,
    items: [["Reviewed open issues and tickets before the meeting.", "check"], ["Updated the status of tickets under my scope.", "check"],
      ["Attended the meeting with central support.", "check"], ["Was it the first or second meeting of the week?", "text"],
      ["Discussed pending issues and support required.", "check"], ["Recorded the agreed actions from the meeting. (Share minutes of meeting)", "text"]] },
  { name: "Washing machine cleanliness and damage check", category: "Facilities", op_role: "CBM", frequency: "weekly", days: "[1]", window_start: "10:30", window_end: "19:30", geofence: 0, late_window_days: 1,
    description: "Useful link: R&M Tickets Sheet (Tickets Tracker_CL_RnM & SCAR)",
    items: [["Checked that the washing machines are clean. (Share timestamped photo)", "check", 1],
      ["Checked that the washing machine area is clean. (Share timestamped photo)", "check", 1],
      ["Was any damage found anywhere in the property (reception, lift, terrace, kitchen, store room, etc.)? Yes/No. If Yes, mention the location, damage and rectification required.", "text"]] },
];
/** Bumped when TEMPLATES changes; databases on an older version get their tasks replaced (see replaceTasks). */
export const TASKS_VERSION = "cbm-2026-11";

/** Inserts TEMPLATES for every property (short-stay tasks only where a Short stays person works). */
export async function seedTemplates() {
  const allProps = (await all<{ id: number }>("SELECT id FROM properties ORDER BY id")).map((p) => p.id);
  const shortStayProps = (await all<{ id: number }>(
    "SELECT DISTINCT up.property_id id FROM user_properties up JOIN users u ON u.id=up.user_id WHERE u.op_role='Short stays' ORDER BY 1")).map((p) => p.id);
  const reviewers = (await all<{ id: number }>("SELECT id FROM users WHERE access_role='reviewer' ORDER BY id")).map((u) => u.id);
  const auditors = (await all<{ id: number }>("SELECT id FROM users WHERE access_role='auditor' ORDER BY id")).map((u) => u.id);
  for (const [ix, t] of TEMPLATES.entries()) {
    const tid = Number((await run(
      `INSERT INTO templates (name, category, op_role, trigger, event_name, frequency, weekday, window_start, window_end, review_sla_h, audit_sla_h,
        attempts_allowed, late_window_days, criticality, audit_rate, geofence, reviewer_id, auditor_id, description, days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      t.name, t.category, t.op_role, t.trigger ?? "scheduled", t.event_name ?? null, t.frequency ?? "daily", t.weekday ?? null,
      t.window_start, t.window_end, t.review_sla_h ?? 24, t.audit_sla_h ?? 48, t.attempts_allowed ?? 3, t.late_window_days ?? 0,
      t.criticality ?? "normal", t.audit_rate ?? 0.2, t.geofence ?? 1, reviewers[ix % reviewers.length] ?? null, auditors[ix % auditors.length] ?? null,
      t.description ?? null, t.days ?? "[]")).lastInsertRowid);
    for (const [pos, [label, kind, photo, countOf]] of t.items.entries())
      await run("INSERT INTO template_items (template_id, pos, label, kind, photo_required, count_of) VALUES (?,?,?,?,?,?)", tid, pos, label, kind, photo ? 1 : 0, countOf ?? null);
    for (const p of t.shortStaysOnly && shortStayProps.length ? shortStayProps : allProps) await run("INSERT INTO template_properties VALUES (?,?)", tid, p);
  }
  await run("INSERT OR REPLACE INTO meta (k, v) VALUES ('tasks', ?)", TASKS_VERSION);
}

/** Removes every task (templates and all their history) and adds the current TEMPLATES in their place. */
export async function replaceTasks() {
  await run("UPDATE escalations SET instance_id=NULL WHERE instance_id IS NOT NULL");
  for (const t of ["review_flags", "reviews", "answers", "submissions", "events", "instances", "template_items", "template_properties", "templates", "checklist_presets"])
    await run(`DELETE FROM ${t}`);
  await seedTemplates();
  for (const [pos, c] of [...new Set(TEMPLATES.map((t) => t.category))].entries()) await run("INSERT OR IGNORE INTO task_categories (name, pos) VALUES (?,?)", c, pos);
  for (const t of await all<{ id: number; name: string }>("SELECT id, name FROM templates ORDER BY id")) {
    const items = await all("SELECT label, kind, photo_required, note_required, photo_allowed, note_allowed, count_of FROM template_items WHERE template_id=? ORDER BY pos", t.id);
    await run("INSERT INTO checklist_presets (title, items) VALUES (?,?)", t.name, JSON.stringify(items));
  }
}

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample HK/SHK headcounts: ideal scales with property size, current runs a little short at some properties. */
export async function seedStaffing() {
  const R = rng(7);
  for (const { id } of await all<{ id: number }>("SELECT id FROM properties ORDER BY id")) {
    const idealHk = 4 + Math.floor(R() * 7), idealShk = idealHk >= 8 ? 2 : 1;
    const currentHk = Math.max(1, idealHk - Math.floor(R() * 4)), currentShk = R() < 0.3 ? idealShk - 1 : idealShk;
    await run("INSERT OR REPLACE INTO staffing (property_id, ideal_hk, current_hk, ideal_shk, current_shk) VALUES (?,?,?,?,?)", id, idealHk, currentHk, idealShk, currentShk);
  }
}

export async function seed() {
  const R = rng(20261029);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const now = Date.now();
  const today = isoDate(now);

  const userId = async (name: string, access: string, op: string | null = null) =>
    Number((await run("INSERT INTO users (name, email, access_role, op_role) VALUES (?,?,?,?)", name,
      name.toLowerCase().replace(/[^a-z]+/g, ".") + "@zolostays.com", access, op)).lastInsertRowid);

  const ids: Record<string, number> = {};
  const propQuality = new Map<number, number>();

  await tx(async () => {
    ids.admin = await userId("Ops Admin", "admin");
    for (const n of ["Vankadara Lakshmi Kavya", "Hrithik Singh", "Priya Menon"]) ids[n] = await userId(n, "reviewer");
    for (const n of ["Karthick L", "Neeraj"]) ids[n] = await userId(n, "auditor");
    for (const n of new Set(Object.values(CBMS))) ids[n] = await userId(n, "cbm", "CBM");

    let nameIx = 0;
    const person = () => `${FIRST[nameIx % FIRST.length]} ${LAST[(nameIx++ * 7) % LAST.length]}`;
    let propIx = 0;
    for (const [city, clusters] of Object.entries(GEO)) {
      const cityId = Number((await run("INSERT INTO cities (name) VALUES (?)", city)).lastInsertRowid);
      for (const [cl, props] of Object.entries(clusters)) {
        const clId = Number((await run("INSERT INTO clusters (city_id, name) VALUES (?,?)", cityId, cl)).lastInsertRowid);
        for (const [name, lat, lng] of props) {
          const cbm = ids[CBMS[cl]];
          const pid = Number((await run("INSERT INTO properties (cluster_id, name, lat, lng, cbm_id) VALUES (?,?,?,?,?)", clId, name, lat, lng, cbm)).lastInsertRowid);
          await run("INSERT INTO user_properties VALUES (?,?)", cbm, pid);
          // A spread of property quality so rankings and RAG have something to say.
          propQuality.set(pid, [0.92, 0.6, 0.85, 0.75, 0.95, 0.5, 0.88, 0.8, 0.7, 0.9, 0.65, 0.85, 0.78, 0.55][propIx++ % 14]);
          const roles = ["HK", "Reception", "CC"];
          if (propIx % 3 !== 0) roles.push("Short stays");
          for (const r of roles) await run("INSERT INTO user_properties VALUES (?,?)", await userId(person(), "ground", r), pid);
        }
      }
    }
    await seedStaffing();
    await seedTemplates();
  });

  // ---- simulate history ----
  type Act = { at: number; fn: () => Promise<void> };
  const queue: Act[] = [];
  const push = (at: number, fn: () => Promise<void>) => { if (at <= now) queue.push({ at, fn }); };
  const templates = await all<Template>("SELECT * FROM templates");
  const items = new Map<number, Item[]>();
  for (const t of templates) items.set(t.id, await itemsFor(t.id));
  const cbmOf = new Map((await all<{ id: number; cbm_id: number }>("SELECT id, cbm_id FROM properties")).map((p) => [p.id, p.cbm_id]));
  const slow = new Map([[ids["Vankadara Lakshmi Kavya"], 2.2], [ids["Hrithik Singh"], 0.8], [ids["Priya Menon"], 1]]);

  const answersFor = (tid: number, q: number, complete: boolean): AnswerInput[] => {
    const its = items.get(tid)!;
    const gap = complete || R() < q ? -1 : Math.floor(R() * its.length);
    return its.map((it, ix) => ({
      itemId: it.id,
      checked: it.kind === "check" ? ix !== gap : true,
      value: it.kind === "number" || it.kind === "count" ? String(1 + Math.floor(R() * 8))
        : it.kind === "text" ? pick(["Yes", "No issues today", "Room 204", "Leaking tap on 2nd floor reported, ticket raised", "First meeting"]) : undefined,
      note: it.note_required ? "Raised with maintenance team" : undefined,
      photos: it.photo_required && ix !== gap ? [`sample:${it.label}`] : [],
    }));
  };

  const scheduleReview = async (id: number, tid: number, submittedAt: number, q: number) => {
    const inst = (await one<Instance>("SELECT * FROM instances WHERE id=?", id))!;
    const t = templates.find((x) => x.id === tid)!;
    const reviewer = inst.reviewer_id!;
    const delay = (1 + R() * t.review_sla_h * 1.1) * (slow.get(reviewer) ?? 1) * HOUR;
    push(submittedAt + delay, async () => {
      const cur = (await one<Instance>("SELECT * FROM instances WHERE id=?", id))!;
      if (!["review", "resub"].includes(cur.status)) return;
      const sub = (await latestSubmission(id))!;
      const missing = await missingEvidence(sub.id, tid);
      const at = submittedAt + delay;
      const flagIt = missing.length > 0 || R() > q + 0.1;
      if (flagIt) {
        const it = missing[0] ?? pick(items.get(tid)!);
        const reason = missing.length ? (it.photo_required ? "Photo missing" : "Item not done") : pick(REASONS.slice(1, 5));
        await reviewDecision(id, reviewer, "changes", [{ itemId: it.id, reason, comment: reason === "Photo unclear" ? "Retake in daylight" : "" }], "", at, at - 20 * 60000);
        const cur2 = (await one<Instance>("SELECT status FROM instances WHERE id=?", id))!;
        if (cur2.status === "changes" && R() < 0.85) {
          const rs = at + (1 + R() * 18) * HOUR;
          push(rs, async () => {
            const c = (await one<Instance>("SELECT status FROM instances WHERE id=?", id))!;
            if (c.status !== "changes") return;
            const ans = answersFor(tid, q, R() < 0.8);
            ans.forEach((a) => { if (a.itemId === it.id) a.reply = "Fixed and re-uploaded"; });
            await submit(id, sub.submitted_by, ans, { ok: true, distance: 40 }, rs);
            await scheduleReview(id, tid, rs, Math.min(1, q + 0.2));
          });
        }
      } else {
        await reviewDecision(id, reviewer, "pass", [], "", at, at - 10 * 60000);
        const c = (await one<Instance>("SELECT status, auditor_id FROM instances WHERE id=?", id))!;
        if (c.status === "audit") {
          const aa = at + (4 + R() * t.audit_sla_h * 1.2) * HOUR;
          push(aa, async () => {
            if ((await one<Instance>("SELECT status FROM instances WHERE id=?", id))!.status !== "audit") return;
            if (R() < 0.22) {
              const it = pick(items.get(tid)!);
              await auditDecision(id, c.auditor_id!, "fail", [{ itemId: it.id, reason: pick(["Photo unclear", "Wrong location", "Item not done"]), comment: "Doesn't match site visit" }], "", aa);
              const an = aa + (3 + R() * 30) * HOUR;
              push(an, async () => {
                const f = await all<{ id: number }>("SELECT f.id FROM review_flags f JOIN reviews r ON r.id=f.review_id WHERE r.instance_id=? AND r.kind='audit' AND f.answer IS NULL", id);
                await answerAuditFlags(id, cbmOf.get(inst.property_id)!, Object.fromEntries(f.map((x) => [x.id, "Re-checked with team, corrected on site"])), an);
                const cl = an + (2 + R() * 20) * HOUR;
                push(cl, async () => await closeFlagAnswers(id, c.auditor_id!, true, cl));
              });
            } else await auditDecision(id, c.auditor_id!, "pass", [], "", aa);
          });
        }
      }
    });
  };

  const start = addDays(today, -14);
  for (let d = start; d <= addDays(today, 1); d = addDays(d, 1)) {
    for (const t of templates) {
      const props = (await all<{ property_id: number }>("SELECT property_id FROM template_properties WHERE template_id=?", t.id)).map((p) => p.property_id);
      if (t.trigger === "event") {
        // A couple of check-outs/bookings per day across short-stay properties.
        if (d > today) continue;
        for (const p of props) {
          if (R() > 0.25) continue;
          const at = atTime(d, `${String(9 + Math.floor(R() * 8)).padStart(2, "0")}:${pick(["05", "20", "40"])}`);
          if (at > now) continue;
          const id = await createInstance(t, p, d, `event:${at}`, at);
          if (id) { await logEvent(id, at, null, "triggered", t.event_name!); await planSubmit(id, t, p); }
        }
        continue;
      }
      if (t.frequency === "weekly" && !list(t.days).includes(weekday(d))) continue;
      for (const p of props) {
        const ws = atTime(d, t.window_start);
        const id = await createInstance(t, p, d, "schedule", Math.min(now, ws));
        if (id) await planSubmit(id, t, p);
      }
    }
  }

  async function planSubmit(id: number, t: Template, p: number) {
    const inst = (await one<Instance>("SELECT * FROM instances WHERE id=?", id))!;
    const q = propQuality.get(p)!;
    const r = R();
    const len = inst.window_end_at - inst.window_start_at;
    if (r < 0.02) { push(inst.window_start_at + 5 * 60000, async () => { try { await waive(id, ids.admin, "Property under renovation", inst.window_start_at + 5 * 60000); } catch {} }); return; }
    let at: number;
    if (r < q) at = inst.window_start_at + R() * len;                                     // on time
    else if (r < q + (1 - q) * 0.55) at = inst.window_end_at + R() * Math.min(inst.late_until_at - inst.window_end_at, 20 * HOUR); // late
    else {
      if (R() < 0.5) push(inst.window_end_at + 2 * HOUR, async () => await logEvent(id, inst.window_end_at + 2 * HOUR, cbmOf.get(p)!, "reminder", "Reminder sent to assignee"));
      return;                                                                            // never submitted
    }
    push(at, async () => {
      const cur = (await one<Instance>("SELECT status FROM instances WHERE id=?", id))!;
      if (!["current", "notsub"].includes(cur.status)) return;
      await submit(id, inst.assignee_id!, answersFor(t.id, q, false), { ok: R() < 0.95, distance: R() < 0.95 ? Math.floor(R() * 150) : 600 + Math.floor(R() * 2000) }, at);
      await scheduleReview(id, t.id, at, q);
    });
  }

  // Run everything in time order, applying time-based transitions before each step.
  // Earliest moment any time-based move can happen; skips the scans between boundaries.
  let nextBoundary = -Infinity;
  const transitions = async (ts: number) => {
    if (ts < nextBoundary) return;
    for (const i of await all<Instance>("SELECT * FROM instances WHERE status='upcoming' AND window_start_at<=?", ts))
      await run("UPDATE instances SET status='current', status_since=? WHERE id=?", i.window_start_at, i.id);
    for (const i of await all<Instance>("SELECT * FROM instances WHERE status='current' AND window_end_at<=?", ts)) {
      await run("UPDATE instances SET status='notsub', status_since=? WHERE id=?", i.window_end_at, i.id);
      await logEvent(i.id, i.window_end_at, null, "window_closed", "Now in late window");
    }
    for (const i of await all<Instance>("SELECT * FROM instances WHERE status='notsub' AND late_until_at<=?", ts)) {
      await run("UPDATE instances SET status='missed', status_since=?, closed_at=? WHERE id=?", i.late_until_at, i.late_until_at, i.id);
      await logEvent(i.id, i.late_until_at, null, "missed", "Late window ended unsubmitted");
    }
    nextBoundary = (await one<{ t: number | null }>(`SELECT min(CASE status WHEN 'upcoming' THEN window_start_at WHEN 'current' THEN window_end_at
      WHEN 'notsub' THEN late_until_at END) t FROM instances WHERE status IN ('upcoming','current','notsub')`))?.t ?? Infinity;
  };
  await tx(async () => {
    while (queue.length) {
      queue.sort((a, b) => a.at - b.at);
      const a = queue.shift()!;
      await transitions(a.at);
      await a.fn();
    }
    await transitions(now);
    // Saved filters, as in the Review Queue mockup.
    const blr = { city: ["Bangalore"], cluster: [], prop: [], role: [], asg: [], mine: false };
    await run("INSERT INTO saved_views (user_id, name, filters, is_default) VALUES (?,?,?,1)", ids["Vankadara Lakshmi Kavya"], "Bangalore", JSON.stringify(blr));
    await run("INSERT INTO saved_views (user_id, name, filters, is_default) VALUES (?,?,?,0)", ids["Vankadara Lakshmi Kavya"], "Koramangala · HK",
      JSON.stringify({ ...blr, cluster: ["Koramangala"], role: ["HK"] }));
  });
  void DAY;
}
