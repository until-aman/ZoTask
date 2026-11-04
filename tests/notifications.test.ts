// The bell: a reminder reaches the person who must act, pops up once, and can be marked read.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as A from "@/app/actions";
import { signInAs, ready, one, handTask, ADMIN, REVIEWER } from "./helpers";
import { run } from "@/lib/db";

before(ready);
const yes = (r: { ok: boolean }) => assert.equal(r.ok, true, JSON.stringify(r));

async function openTask() {
  const prop = (await one<{ property_id: number; op_role: string }>(`SELECT up.property_id, u.op_role FROM user_properties up JOIN users u ON u.id=up.user_id
    WHERE u.access_role='ground' AND u.archived=0 AND u.op_role IS NOT NULL GROUP BY up.property_id, u.op_role ORDER BY count(*) DESC LIMIT 1`))!;
  const tid = await handTask([prop.property_id]);
  await run("UPDATE templates SET op_role=? WHERE id=?", prop.op_role, tid);
  signInAs(ADMIN);
  yes(await A.triggerTask(tid, prop.property_id));
  return (await one<{ id: number; assignee_id: number }>("SELECT id, assignee_id FROM instances WHERE template_id=? ORDER BY id DESC LIMIT 1", tid))!;
}

test("a reminder lands in the doer's bell, pops up once, and can be read", async () => {
  const t = await openTask();
  signInAs(REVIEWER);
  yes(await A.remindTasks([t.id]));
  signInAs(t.assignee_id);
  const a = (await A.myNotifications())!;
  const n = a.items.find((x) => x.kind === "reminder" && x.link === `/tasks/${t.id}`);
  assert.ok(n, "the reminder is in the list");
  assert.ok(a.unread >= 1);
  assert.ok(a.pop.some((x) => x.id === n!.id), "it pops up the first time");
  assert.ok(n!.actor, "it says who sent it");
  const b = (await A.myNotifications())!;
  assert.ok(!b.pop.some((x) => x.id === n!.id), "but only once");
  await A.readNotifications([n!.id]);
  const c = (await A.myNotifications())!;
  assert.equal(c.unread, a.unread - 1);
  assert.equal(c.items.find((x) => x.id === n!.id)!.read, true);
  await A.readNotifications("all");
  assert.equal((await A.myNotifications())!.unread, 0);
});

test("someone else can't read or clear your notifications", async () => {
  const t = await openTask();
  signInAs(REVIEWER);
  yes(await A.remindTasks([t.id]));
  const mine = (await A.myNotifications())!;
  assert.ok(!mine.items.some((x) => x.link === `/tasks/${t.id}` && x.kind === "reminder"), "the sender doesn't get it");
  const theirs = (await one<{ id: number }>("SELECT id FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1", t.assignee_id))!;
  await A.readNotifications([theirs.id]);
  assert.equal((await one<{ read_at: number | null }>("SELECT read_at FROM notifications WHERE id=?", theirs.id))!.read_at, null);
});
