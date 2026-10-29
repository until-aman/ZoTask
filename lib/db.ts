import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seed } from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

type G = { __zotaskDb?: Database.Database };
const g = globalThis as G;

export function db(): Database.Database {
  if (g.__zotaskDb) return g.__zotaskDb;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const d = new Database(path.join(DATA_DIR, "zotask.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8"));
  g.__zotaskDb = d;
  const seeded = d.prepare("SELECT v FROM meta WHERE k='seeded'").get();
  if (!seeded) {
    seed();
    d.prepare("INSERT INTO meta (k, v) VALUES ('seeded', ?)").run(String(Date.now()));
  }
  return d;
}

export function all<T = any>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function one<T = any>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...params);
}
export function tx<T>(fn: () => T): T {
  return db().transaction(fn)();
}
