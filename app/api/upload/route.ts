import crypto from "node:crypto";
import { currentUser } from "@/lib/auth";
import { saveFile } from "@/lib/files";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" };

export async function POST(req: Request) {
  if (!(await currentUser())) return new Response("Sign in first", { status: 401 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return new Response("No file", { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return new Response("Images only", { status: 415 });
  // Vercel caps a request body at 4.5 MB.
  if (file.size > 4 * 1024 * 1024) return new Response("Max 4 MB", { status: 413 });
  const name = `${crypto.randomUUID()}.${ext}`;
  await saveFile(name, await file.arrayBuffer(), file.type);
  return Response.json({ name });
}
