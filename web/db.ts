// Browser stand-in for lib/db.ts: the same small API over sql.js (SQLite compiled to JS), held in memory.
import schema from "../lib/schema.sql";
import { seed } from "../lib/seed";
import { seedEscalations } from "../lib/escalations";

type Stmt = { bind(p: unknown[]): void; step(): boolean; getAsObject(): Record<string, unknown>; reset(): void };
type SqlDb = { prepare(sql: string): Stmt; exec(sql: string): { values: unknown[][] }[]; run(sql: string): void; getRowsModified(): number };
let raw: SqlDb | null = null;
const cache = new Map<string, Stmt>();
export const UPLOAD_DIR = "";

function stmt(sql: string) {
  let s = cache.get(sql);
  if (!s) { s = raw!.prepare(sql); cache.set(sql, s); }
  return s;
}
const norm = (p: unknown[]) => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
function prepare(sql: string) {
  return {
    all: (...p: unknown[]) => { const s = stmt(sql); s.bind(norm(p)); const out = []; while (s.step()) out.push(s.getAsObject()); s.reset(); return out; },
    get: (...p: unknown[]) => { const s = stmt(sql); s.bind(norm(p)); const r = s.step() ? s.getAsObject() : undefined; s.reset(); return r; },
    run: (...p: unknown[]) => {
      const s = stmt(sql); s.bind(norm(p)); s.step(); s.reset();
      const changes = raw!.getRowsModified();
      const id = raw!.exec("SELECT last_insert_rowid()")[0].values[0][0];
      return { changes, lastInsertRowid: id as number };
    },
  };
}
let inTx = false;
async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  // One tab, one user: a tx() started while another runs simply joins it.
  if (inTx) return fn();
  inTx = true;
  raw!.run("SAVEPOINT tx");
  try { const r = await fn(); raw!.run("RELEASE tx"); return r; }
  catch (e) { raw!.run("ROLLBACK TO tx"); raw!.run("RELEASE tx"); throw e; }
  finally { inTx = false; }
}

export async function init(initSqlJs: (o?: unknown) => Promise<{ Database: new () => SqlDb }>) {
  const SQL = await initSqlJs();
  raw = new SQL.Database();
  raw.exec(schema);
  await seed();
  await seedEscalations();
  raw.run("INSERT INTO meta (k, v) VALUES ('seeded', '1')");
}
export async function all<T = any>(sql: string, ...params: unknown[]): Promise<T[]> { return prepare(sql).all(...params) as T[]; }
export async function one<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> { return prepare(sql).get(...params) as T | undefined; }
export async function run(sql: string, ...params: unknown[]) { return prepare(sql).run(...params); }
export function tx<T>(fn: () => Promise<T>): Promise<T> { return transaction(fn); }
export async function batch(stmts: [sql: string, ...params: unknown[]][]) { await transaction(async () => { for (const [sql, ...p] of stmts) prepare(sql).run(...p); }); }
