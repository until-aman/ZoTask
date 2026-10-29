import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";

export default async function Home() {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.access_role === "admin" || u.access_role === "cbm") redirect("/dashboard");
  redirect(can.queue(u) ? "/queue" : "/tasks");
}
