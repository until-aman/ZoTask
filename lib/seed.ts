// Sample Zolo data plus 14 days of simulated task history, so every screen has something real to show.
import { all, one, run, tx } from "./db";
import {
  AnswerInput, Instance, Item, Template, appliesOn, auditDecision, answerAuditFlags, closeFlagAnswers, createInstance,
  itemsFor, missingEvidence, latestSubmission, logEvent, reviewDecision, submit, waive, REASONS,
} from "./engine";
import { DAY, HOUR, addDays, atTime, isoDate } from "./time";
import { insertTaskList } from "./cbm-tasks";

export const GEO: Record<string, Record<string, [string, number, number][]>> = {
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
  const shortStayProps: number[] = [];

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
          if (propIx % 3 !== 0) { roles.push("Short stays"); shortStayProps.push(pid); }
          for (const r of roles) await run("INSERT INTO user_properties VALUES (?,?)", await userId(person(), "ground", r), pid);
        }
      }
    }
    const allProps = (await all<{ id: number }>("SELECT id FROM properties")).map((p) => p.id);
    await seedStaffing();
    const reviewers = [ids["Vankadara Lakshmi Kavya"], ids["Hrithik Singh"], ids["Priya Menon"]];
    const auditors = [ids["Karthick L"], ids["Neeraj"]];
    await insertTaskList(reviewers, auditors, shortStayProps);
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
      value: ix === gap && it.kind !== "check" ? undefined
        : it.kind === "yesno" ? (R() < 0.85 ? "Yes" : "No")
        : it.kind === "number" || it.kind === "count" ? String(it.label.includes("%") ? 40 + Math.floor(R() * 60) : 1 + Math.floor(R() * 8))
        : it.kind === "text" ? pick(["All good", "Two residents asked about Wi-Fi speed", "Leaking tap on 2nd floor reported", "No issues today", "Corridor light replaced"]) : undefined,
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
      if (!appliesOn(t, d)) continue;
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
    await run("INSERT INTO saved_views (user_id, name, filters, is_default) VALUES (?,?,?,0)", ids["Vankadara Lakshmi Kavya"], "Koramangala",
      JSON.stringify({ ...blr, cluster: ["Koramangala"] }));
  });
  void DAY;
}
