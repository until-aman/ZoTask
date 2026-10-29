// Database access over libSQL: a local SQLite file in development, Turso when TURSO_DATABASE_URL is set (e.g. on Vercel).
import { createClient, type Client, type InStatement, type InValue } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import Database from "libsql";
import fs from "node:fs";
import path from "node:path";
import { seed, seedStaffing } from "./seed";
import { seedEscalations } from "./escalations";

const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const REMOTE = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "";

type Conn = Pick<Client, "execute">;
type G = { __zotaskDb?: Promise<Client> };
const g = globalThis as G;
// Where queries go: the open transaction inside tx(), or the in-memory database while seeding. Otherwise the main client.
const scope = new AsyncLocalStorage<Conn>();
const schema = () => fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");

function open(): Client {
  if (REMOTE) return createClient({ url: REMOTE, authToken: process.env.TURSO_AUTH_TOKEN });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return createClient({ url: `file:${path.join(DATA_DIR, "zotask.db")}` });
}

async function init(): Promise<Client> {
  const c = open();
  if (!REMOTE) await c.execute("PRAGMA journal_mode = WAL");
  await c.executeMultiple(schema());
  // Columns added after a database was first created.
  const cols = (await c.execute("PRAGMA table_info(saved_views)")).rows.map((r) => String(r.name));
  if (!cols.includes("page")) await c.execute("ALTER TABLE saved_views ADD COLUMN page TEXT NOT NULL DEFAULT 'queue'");
  if (!(await c.execute("SELECT v FROM meta WHERE k='seeded'")).rows.length) await seedInto(c);
  // Databases created before headcounts or escalations existed get sample rows too.
  await scope.run(c, async () => {
    if (!(await one<{ n: number }>("SELECT count(*) n FROM staffing"))!.n) await seedStaffing();
    if (!(await one<{ n: number }>("SELECT count(*) n FROM escalations"))!.n) await seedEscalations();
  });
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
  await scope.run(conn, async () => { await seed(); await seedEscalations(); });
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
