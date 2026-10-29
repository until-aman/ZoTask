import path from "node:path";
import { currentUser } from "@/lib/auth";
import { serveFile } from "@/lib/files";

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!(await currentUser())) return new Response("Sign in first", { status: 401 });
  return serveFile(path.basename((await params).name));
}
