# ZoTask (local clone)

A working clone of ZoTask, Zolo's recurring-operations task platform: scheduled and event-triggered tasks, ground-team checklists with photos and location checks, central review, audit sampling, task history, and an operations command-center dashboard. It ships with sample Zolo data (4 cities, 7 clusters, 14 properties, about 60 people) and 14 days of simulated history, so every screen has something to show.

## Run it

Needs Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and pick anyone on the sign-in page to see ZoTask from their side. The database is created and seeded on first load in `data/zotask.db`. Run `npm run reset` to wipe it and start fresh from today's date.

For a production build: `npm run build && npm start`.

## Put it online (Vercel + Turso, free plans)

The app stores data in SQLite through libSQL, so the same code runs on a local file or on [Turso](https://turso.tech) (hosted SQLite). Photos go to `data/uploads` locally, or to Vercel Blob when it is connected.

1. Import this repository in Vercel (Add New → Project). No build settings need changing.
2. In the project's Storage tab, create a **Turso** database (free plan, region Mumbai) and connect it. That adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
3. In the same tab, create a **Blob** store and connect it. That adds `BLOB_READ_WRITE_TOKEN`.
4. Redeploy. The first visit creates the tables and loads the sample data (a few seconds).

`vercel.json` pins the server to Mumbai (`bom1`) so it sits next to a Mumbai database. Photos are shrunk in the browser before upload to stay under Vercel's 4.5 MB request limit.

## Who sees what

| Role | Screens |
|---|---|
| Ground team (HK, Reception, CC, Short stays) | My Tasks: fill checklists, upload photos (max 10 per item), validate location, resubmit flagged items |
| CBM | My Tasks (CBM tasks), answer audit flags, Review Queue and dashboard for their properties, waive tasks |
| Reviewer | Review Queue, review sheet (pass or flag with reason codes), reopen, reassign, reminders |
| Auditor | To Audit and Flag Answers tabs, audit pass or fail, close CBM answers |
| Admin | Everything, plus Admin: task setup, event triggers, properties and people |

## Task lifecycle

`upcoming → current → (submitted) review → done`, with these branches:

- Window closes unsubmitted → `notsub` (late window) → `missed` when the late window ends
- Reviewer flags items → `changes` → resubmit → `resub` → review again; when attempts run out → `notrect`
- Pass → sampled for audit (template's audit rate) → `audit` → pass → `done`, or fail → `auditflag` (CBM answers) → `flagans` → auditor closes → `done`
- `waived` tasks are excluded from every denominator

Time-based moves (`lib/engine.ts → sweep`) run on every page load, and today's and tomorrow's scheduled tasks are generated then too.

## What's built from the audit report

- **Review Queue (Phase 1 mockup):** City → Cluster → Property multi-select, dates default to today and apply to all tabs, saved filters with a default view, status sidebar grouped by who acts next, over-SLA badges, age against SLA, waiting buckets, Next step column, bulk remind and reassign, detail drawer with history.
- **Metric fixes:** on-time measured over tasks past their deadline; review SLA compliance counts the overdue backlog; "verified" counts tasks, not pass decisions; overdue split into recoverable vs missed; first-pass approval rate; one accountable CBM per property so rollups add up.
- **Review quality:** a pass is blocked when mandatory evidence is missing; structured rejection reasons; attempts shown side by side; durations between steps in the history; separation of duties (submitter can't review, reviewer can't audit).
- **Command center:** three scorecards (Execution, Review, Closure) with change vs previous period and RAG, an Attention list ranked by severity and age with an owner on every row, reason-code breakdown, properties ranked worst first with daily sparklines, reviewer and CBM tables. Every number links to the tasks behind it.

## Code map

- `lib/schema.sql` – tables
- `lib/db.ts` – database access (local file or Turso), transactions, first-run seeding
- `lib/files.ts` – photo storage (disk or Vercel Blob)
- `lib/engine.ts` – lifecycle rules (generate, sweep, submit, review, audit, flags, waive, remind)
- `lib/seed.ts` – sample data and history simulation
- `lib/metrics.ts` – shared KPI helpers (date ranges, loaders)
- `lib/command.ts` – the command-center dashboard: every figure with the task ids behind it, the action queue, trends, lifecycle, comparisons
- `lib/detail.ts` – one task's full record for the dashboard's side drawer
- `app/` – pages (`tasks`, `queue`, `review/[id]`, `dashboard`, `admin`) and server actions (`actions.ts`)
- `components/` – client components (QueueClient, TaskForm, ReviewForm, TemplateEditor…); `components/cc/` is the dashboard

Not included yet: real notifications (reminders are logged in history only), SSO, and integration with the booking system (event tasks are triggered from Admin).

## Browser prototype

`node web/build.mjs` builds `web/dist/zotask.html`, a single file that runs the same pages and engine in the browser on an in-memory SQLite database (sql.js). It's what the shareable prototype link is built from; nothing persists between reloads.
