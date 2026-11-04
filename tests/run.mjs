// Runs tests/*.test.ts with node:test. Each file is bundled with esbuild (so "@/..." imports work)
// and runs against a fresh, seeded database in its own temporary folder. The clock zone defaults to UTC, like Vercel.
import * as esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const only = process.argv.slice(2);
const files = fs.readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".test.ts") && (!only.length || only.some((o) => f.includes(o))));
const out = fs.mkdtempSync(path.join(os.tmpdir(), "tasktrail-test-"));
const alias = {
  name: "alias",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => b.resolve("./" + a.path.slice(2), { resolveDir: root, kind: a.kind }));
    b.onResolve({ filter: /^next\/(headers|cache|navigation)$/ }, (a) => ({ path: path.join(root, "tests/shims", a.path.split("/")[1] + ".ts") }));
  },
};
let failed = 0;
for (const f of files) {
  const dir = fs.mkdtempSync(path.join(out, f.replace(/\W/g, "_")));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.copyFileSync(path.join(root, "lib/schema.sql"), path.join(dir, "lib/schema.sql"));
  const bundle = path.join(dir, "test.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, "tests", f)], bundle: true, platform: "node", format: "esm", outfile: bundle, target: "node20",
    external: ["libsql", "@libsql/client", "@vercel/blob"], plugins: [alias], logLevel: "warning", jsx: "automatic",
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
  const env = { ...process.env, NODE_PATH: path.join(root, "node_modules"), TZ: process.env.TZ || "UTC" };
  for (const k of Object.keys(env)) if (k.includes("TURSO") || k === "DATABASE_URL" || k.startsWith("BLOB")) delete env[k];
  fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", bundle], { cwd: dir, env, stdio: "inherit" });
  if (r.status !== 0) failed++;
}
fs.rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
