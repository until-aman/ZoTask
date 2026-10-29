// Builds the single-file browser prototype: web/dist/zotask.html
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const shim = (f) => path.join(root, "web/shims", f);
const plugin = {
  name: "zotask-web",
  setup(b) {
    b.onResolve({ filter: /^next\/(headers|cache|navigation|link)$/ }, (a) => ({ path: shim({ "next/headers": "headers.ts", "next/cache": "cache.ts", "next/navigation": "navigation.ts", "next/link": "link.tsx" }[a.path]) }));
    b.onResolve({ filter: /^@\// }, async (a) => b.resolve("./" + a.path.slice(2), { resolveDir: root, kind: a.kind }));
    b.onResolve({ filter: /(^|\/)db$/ }, (a) => {
      const p = path.resolve(a.resolveDir, a.path);
      return p === path.join(root, "lib/db") ? { path: path.join(root, "web/db.ts") } : undefined;
    });
  },
};
const out = await esbuild.build({
  entryPoints: [path.join(root, "web/main.tsx")], bundle: true, write: false, minify: true, format: "iife", target: "es2020",
  jsx: "automatic", loader: { ".sql": "text" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "warning",
});
const esc = (s) => s.replace(/<\/script/gi, "<\\/script");
const app = out.outputFiles[0].text;
const sql = fs.readFileSync(path.join(root, "node_modules/sql.js/dist/sql-asm.js"), "utf8");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8")
  .replace(".top{position:sticky;top:0;", ".top{position:sticky;top:env(safe-area-inset-top,0px);");
const html = `<title>ZoTask Prototype</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap">
<style>
${css}
/* Single light theme on purpose: it mirrors the real ZoTask app. */
:root{color-scheme:light}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:41;background:var(--card)}
.proto{background:var(--fg);color:#fff;font-size:12.5px;font-weight:600;text-align:center;padding:6px 16px}
.boot{min-height:60vh;display:grid;place-items:center;color:var(--muted);font-weight:700}
</style>
<div id="root"><div class="boot">Setting up ZoTask with 14 days of sample data…</div></div>
<script>${esc(sql)}</script>
<script>${esc(app)}</script>
`;
fs.mkdirSync(path.join(root, "web/dist"), { recursive: true });
fs.writeFileSync(path.join(root, "web/dist/zotask.html"), html);
console.log("wrote web/dist/zotask.html", (html.length / 1e6).toFixed(2), "MB");
