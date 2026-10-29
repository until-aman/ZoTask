"use client";
import { useRouter } from "next/navigation";

export default function DateJump({ tab, date }: { tab: string; date: string }) {
  const router = useRouter();
  return <input type="date" id="tasks-date" value={date} aria-label="Date" onChange={(e) => e.target.value && router.push(`/tasks?tab=${tab}&date=${e.target.value}`)} />;
}
