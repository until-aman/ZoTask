// Database access over libSQL: a local SQLite file in development, Turso when TURSO_DATABASE_URL is set (e.g. on Vercel).
import { createClient, type Client, type InStatement, type InValue } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import Database from "libsql";
import fs from "node:fs";
import path from "node:path";
import { seed, seedStaffing } from "./seed";
import { seedEscalations } from "./escalations";
import { seedLibraries } from "./libraries";
import { TASK_LIST_VERSION, taskListDone, taskListStatements } from "./cbm-tasks";
import { removeSampleEscalations, removeSampleReviewers } from "./people";

const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
// Turso's Vercel integration can add a custom prefix to its variable names, so also take any libsql:// URL and *_AUTH_TOKEN.
const env = Object.entries(process.env);
export const REMOTE = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || env.find(([, v]) => v?.startsWith("libsql://"))?.[1] || "";
const TOKEN = process.env.TURSO_AUTH_TOKEN || env.find(([k]) => k.endsWith("_AUTH_TOKEN") && !k.startsWith("BLOB"))?.[1];

type Conn = Pick<Client, "execute">;
type G = { __zotaskDb?: Promise<Client> };
const g = globalThis as G;
// Where queries go: the open transaction inside tx(), or the in-memory database while seeding. Otherwise the main client.
const scope = new AsyncLocalStorage<Conn>();
const schema = () => fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");

function open(): Client {
  if (REMOTE) return createClient({ url: REMOTE, authToken: TOKEN });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return createClient({ url: `file:${path.join(DATA_DIR, "zotask.db")}` });
}

async function init(): Promise<Client> {
  const c = open();
  if (!REMOTE) await c.execute("PRAGMA journal_mode = WAL");
  await c.executeMultiple(schema());
  // Columns added after a database was first created.
  const added: [string, string, string][] = [
    ["saved_views", "page", "TEXT NOT NULL DEFAULT 'queue'"],
    ["templates", "description", "TEXT"], ["templates", "events", "TEXT NOT NULL DEFAULT '[]'"], ["templates", "days", "TEXT NOT NULL DEFAULT '[]'"],
    ["templates", "once_date", "TEXT"], ["templates", "start_stop", "INTEGER NOT NULL DEFAULT 1"], ["templates", "geofence_m", "INTEGER NOT NULL DEFAULT 200"],
    ["templates", "ideal_minutes", "INTEGER"], ["templates", "review_required", "INTEGER NOT NULL DEFAULT 1"], ["templates", "assignees", "TEXT NOT NULL DEFAULT '[]'"],
    ["template_items", "photo_allowed", "INTEGER NOT NULL DEFAULT 1"], ["template_items", "note_allowed", "INTEGER NOT NULL DEFAULT 1"], ["template_items", "count_of", "TEXT"], ["template_items", "options", "TEXT"],
    ["clusters", "reviewer_id", "INTEGER"], ["clusters", "auditor_id", "INTEGER"], ["clusters", "archived", "INTEGER NOT NULL DEFAULT 0"],
    ["map_sites", "gender", "TEXT"], ["map_sites", "details", "TEXT"], ["submissions", "location_src", "TEXT"], ["template_items", "guide", "TEXT"],
    ["users", "archived", "INTEGER NOT NULL DEFAULT 0"], ["users", "week_off", "TEXT NOT NULL DEFAULT '[]'"], ["users", "backup_id", "INTEGER"],
    ["instances", "wk", "TEXT"], ["instances", "wk_why", "TEXT"], ["instances", "wk_closed_at", "INTEGER"],
  ];
  const have = new Map<string, string[]>();
  for (const [table, col, type] of added) {
    if (!have.has(table)) have.set(table, (await c.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
    if (!have.get(table)!.includes(col)) await c.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  if (!(await c.execute("SELECT v FROM meta WHERE k='seeded'")).rows.length) await seedInto(c);
  // Databases created before headcounts or escalations existed get sample rows too.
  await scope.run(c, async () => {
    if (!(await one<{ n: number }>("SELECT count(*) n FROM staffing"))!.n) await seedStaffing();
    if (!(await one<{ n: number }>("SELECT count(*) n FROM escalations"))!.n) await seedEscalations();
    if (!(await one<{ n: number }>("SELECT count(*) n FROM task_categories"))!.n) await seedLibraries();
  });
  // Task list changes go as one batch: a single round trip that the database applies atomically, so a slow or
  // busy start can't leave half a list, and two servers starting at once still end with one copy of each task.
  // If it fails, the app still opens and the next start tries again.
  try {
    if (!(await scope.run(c, taskListDone))) {
      const stmts = await scope.run(c, taskListStatements);
      if (stmts.length) await c.batch(["PRAGMA defer_foreign_keys = ON", ...stmts], "write");
    }
  } catch (e) { console.error("Task list update failed; will retry on the next start", e); }
  // The live database only: the sample data's reviewers, properties and escalations give way to the real ones.
  if (REMOTE) {
    try { await c.batch([...await scope.run(c, removeSampleReviewers), ...await scope.run(c, removeSampleEscalations)], "write"); }
    catch (e) { console.error("Removing the sample data failed; will retry on the next start", e); }
  }
  return c;
}

/** In-memory SQLite with cached statements: seeding runs thousands of small queries, several times faster this way. */
function memory() {
  const d = new Database(":memory:");
  const cache = new Map<string, ReturnType<typeof d.prepare>>();
  const execute = async (q: InStatement) => {
    const { sql, args = [] } = typeof q === "string" ? { sql: q } : q;
    let st = cache.get(sql);
    if (!st) cache.set(sql, (st = d.prepare(sql)));
    const p = args as [never];
    if (st.reader) return { columns: st.columns().map((c: { name: string }) => c.name), rows: st.raw().all(...p), rowsAffected: 0, lastInsertRowid: undefined };
    const r = st.run(...p);
    return { columns: [], rows: [], rowsAffected: r.changes, lastInsertRowid: BigInt(r.lastInsertRowid) };
  };
  return { d, conn: { execute } as unknown as Conn };
}

/** Builds the sample data in memory (thousands of small writes), then copies it over in a few large batches. */
async function seedInto(target: Client) {
  const { d, conn } = memory();
  d.exec(schema());
  await scope.run(conn, async () => { await seed(); await seedEscalations(); await seedLibraries(); });
  const tables = (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'meta'").all() as { name: string }[]).map((r) => r.name);
  const stmts: InStatement[] = [];
  for (const t of tables) {
    const st = d.prepare(`SELECT * FROM "${t}"`);
    const columns = st.columns().map((c: { name: string }) => c.name), rows = st.raw().all() as InValue[][];
    const cols = columns.map((c: string) => `"${c}"`).join(",");
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      stmts.push({ sql: `INSERT OR IGNORE INTO "${t}" (${cols}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}`, args: chunk.flat() });
    }
  }
  d.close();
  // Sent in parts to keep each request small. Rows keep their ids and "seeded" goes in last,
  // so if a part fails the next start finishes the job instead of duplicating it.
  for (let i = 0; i < stmts.length; i += 25) await target.batch(["PRAGMA defer_foreign_keys = ON", ...stmts.slice(i, i + 25)], "write");
  await target.batch([
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES ('task_list', ?)", args: [TASK_LIST_VERSION] },
    { sql: "INSERT OR REPLACE INTO meta (k, v) VALUES ('task_list_clean', ?)", args: [TASK_LIST_VERSION] },
  ], "write");
  await target.execute({ sql: "INSERT OR IGNORE INTO meta (k, v) VALUES ('seeded', ?)", args: [String(Date.now())] });
}

export function db(): Promise<Client> {
  return (g.__zotaskDb ??= init().catch((e) => { g.__zotaskDb = undefined; throw e; }));
}

const norm = (p: unknown[]) => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)) as InValue[];

export async function all<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
  const rs = await (scope.getStore() ?? (await db())).execute({ sql, args: norm(params) });
  return rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]]))) as T[];
}
export async function one<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return (await all<T>(sql, ...params))[0];
}
export async function run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
  const c = scope.getStore();
  // Locally every write goes through the queue below, so two writers never meet on the SQLite file.
  if (!c && !REMOTE) return tx(() => run(sql, ...params));
  const rs = await (c ?? (await db())).execute({ sql, args: norm(params) });
  return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
}

/** Several writes in one round trip, all or nothing. */
export async function batch(stmts: [sql: string, ...params: unknown[]][]) {
  const c = scope.getStore();
  if (c) { for (const [sql, ...p] of stmts) await c.execute({ sql, args: norm(p) }); return; }
  const go = async () => { await (await db()).batch(stmts.map(([sql, ...p]) => ({ sql, args: norm(p) })), "write"); };
  const p = queue.then(go, go);
  queue = p.catch(() => {});
  return p;
}

// One write transaction at a time per server instance. A tx() inside another (or while seeding) joins it.
let queue: Promise<unknown> = Promise.resolve();
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return fn();
  const go = async () => {
    const t = await (await db()).transaction("write");
    try { const r = await scope.run(t, fn); await t.commit(); return r; }
    catch (e) { await t.rollback().catch(() => {}); throw e; }
    finally { t.close(); }
  };
  const p = queue.then(go, go);
  queue = p.catch(() => {});
  return p;
}
