import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, UPLOAD_DIR } from "@/lib/db";
import { currentUser } from "@/lib/auth";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" };

export async function POST(req: Request) {
  if (!(await currentUser())) return new Response("Sign in first", { status: 401 });
  db();
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return new Response("No file", { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return new Response("Images only", { status: 415 });
  if (file.size > 10 * 1024 * 1024) return new Response("Max 10 MB", { status: 413 });
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
  return Response.json({ name });
}
