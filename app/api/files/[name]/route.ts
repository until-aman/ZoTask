import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/db";

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif" };

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const name = path.basename((await params).name);
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": MIME[name.split(".").pop()!] ?? "application/octet-stream" } });
}
