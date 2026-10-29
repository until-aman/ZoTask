// Uploaded photos: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else data/uploads on disk.
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "./db";

const BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
export const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif" };
// A Blob store is created either private or public; try private first and remember what worked.
let access: ("private" | "public")[] = ["private", "public"];

export async function saveFile(name: string, data: ArrayBuffer, type: string) {
  if (!BLOB) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(data));
    return;
  }
  const { put } = await import("@vercel/blob");
  let err: unknown;
  for (const a of access) {
    try {
      await put(`uploads/${name}`, Buffer.from(data), { access: a, contentType: type, addRandomSuffix: false });
      access = [a];
      return;
    } catch (e) { err = e; }
  }
  throw err;
}

/** The photo itself; only signed-in users reach it, since the route checks the session first. */
export async function serveFile(name: string): Promise<Response> {
  const headers = { "Content-Type": MIME[name.split(".").pop()!] ?? "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" };
  if (!BLOB) {
    const file = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
    return new Response(fs.readFileSync(file), { headers });
  }
  const { get } = await import("@vercel/blob");
  for (const a of access) {
    try {
      const r = await get(`uploads/${name}`, { access: a });
      if (r) { access = [a]; return new Response(r.stream, { headers }); }
    } catch { /* try the other access level */ }
  }
  return new Response("Not found", { status: 404 });
}
