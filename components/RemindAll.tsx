"use client";
import { useState } from "react";
import { remindTasks } from "@/app/actions";

export default function RemindAll({ ids }: { ids: number[] }) {
  const [msg, setMsg] = useState("");
  if (msg) return <span className="small ok">{msg}</span>;
  return <button className="btn sm primary" onClick={async () => { const r = await remindTasks(ids); setMsg(r.ok ? r.msg ?? "Sent" : r.error); }}>Remind all</button>;
}
