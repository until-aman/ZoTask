"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerFlags } from "@/app/actions";

type Item = { id: number; label: string };
type Flag = { id: number; item_id: number; reason: string; comment: string | null; answer: string | null };

export default function FlagAnswerForm({ instanceId, items, flags }: { instanceId: number; items: Item[]; flags: Flag[] }) {
  const router = useRouter();
  const [text, setText] = useState<Record<number, string>>(() => Object.fromEntries(flags.map((f) => [f.id, f.answer ?? ""])));
  const [err, setErr] = useState("");
  async function send() {
    if (flags.some((f) => !text[f.id]?.trim())) return setErr("Answer every flag before sending.");
    const r = await answerFlags(instanceId, text);
    if (!r.ok) return setErr(r.error);
    router.refresh();
  }
  return (
    <div className="card grid">
      <h2>The auditor flagged this task</h2>
      <p className="muted small" style={{ margin: 0 }}>As the property's CBM, explain what happened and what was done. The auditor then closes the flags or sends them back.</p>
      {flags.map((f) => (
        <div key={f.id} className="item flagged">
          <b>{items.find((i) => i.id === f.item_id)?.label}</b>
          <div className="small warn">{f.reason}{f.comment ? ` · “${f.comment}”` : ""}</div>
          <textarea placeholder="Your answer" value={text[f.id]} onChange={(e) => setText({ ...text, [f.id]: e.target.value })} />
        </div>
      ))}
      {err && <div className="err">{err}</div>}
      <div><button className="btn primary" onClick={send}>Send answers</button></div>
    </div>
  );
}
