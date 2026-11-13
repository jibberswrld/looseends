import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { hydrate, toAction } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

/** Reminders whose time has come and that haven't been shown yet. */
export const GET = handle(async () => {
  const { user } = await requireReady();
  const actions = await sql`
    select * from actions where user_id = ${user.id} and kind = 'reminder' and fired_at is null and remind_at <= now()
    order by remind_at asc limit 20`;
  if (actions.length === 0) return json({ reminders: [] });
  const taskRows = await sql`select * from tasks where id = any(${actions.map((a) => a.task_id)}::uuid[]) and status not in ('completed', 'dismissed')`;
  const tasks = new Map((await hydrate(taskRows)).map((t) => [t.id, t]));
  return json({
    reminders: actions.filter((a) => tasks.has(a.task_id)).map((a) => ({ action: toAction(a), task: tasks.get(a.task_id)! })),
  });
});
