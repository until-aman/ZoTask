// Uploaded photos. Where they go, in order:
// 1. Vercel Blob, when a Blob store is connected (BLOB_READ_WRITE_TOKEN, or the same token under a custom prefix).
// 2. The database, when it is Turso (e.g. on Vercel without a Blob store, where the disk is read-only).
// 3. data/uploads on disk, when running locally.
import fs from "node:fs";
import path from "node:path";
import { REMOTE, UPLOAD_DIR, db } from "./db";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN
  || Object.entries(process.env).find(([k, v]) => k.endsWith("READ_WRITE_TOKEN") && v?.startsWith("vercel_blob_rw_"))?.[1];
export const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif" };
// A Blob store is created either private or public; try private first and remember what worked.
let access: ("private" | "public")[] = ["private", "public"];

export async function saveFile(name: string, data: ArrayBuffer, type: string) {
  if (TOKEN) {
    const { put } = await import("@vercel/blob");
    let err: unknown;
    for (const a of access) {
      try {
        await put(`uploads/${name}`, Buffer.from(data), { access: a, contentType: type, addRandomSuffix: false, token: TOKEN });
        access = [a];
        return;
      } catch (e) { err = e; }
    }
    // The Blob store refused (e.g. suspended or misconfigured): keep the photo in the database rather than lose it.
    if (!REMOTE) throw err;
    console.error("Blob upload failed; storing the photo in the database instead", err);
  }
  if (REMOTE) {
    await (await db()).execute({ sql: "INSERT OR REPLACE INTO photos (name, type, data, at) VALUES (?,?,?,?)", args: [name, type, new Uint8Array(data), Date.now()] });
    return;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(data));
}

/** The photo itself; only signed-in users reach it, since the route checks the session first. */
export async function serveFile(name: string): Promise<Response> {
  const headers = { "Content-Type": MIME[name.split(".").pop()!] ?? "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" };
  if (TOKEN) {
    const { get } = await import("@vercel/blob");
    for (const a of access) {
      try {
        const r = await get(`uploads/${name}`, { access: a, token: TOKEN });
        if (r) { access = [a]; return new Response(r.stream, { headers }); }
      } catch { /* try the other access level */ }
    }
  }
  if (REMOTE) {
    const row = (await (await db()).execute({ sql: "SELECT data FROM photos WHERE name=?", args: [name] })).rows[0];
    return row ? new Response(new Uint8Array(row.data as ArrayBuffer), { headers }) : new Response("Not found", { status: 404 });
  }
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers });
}
