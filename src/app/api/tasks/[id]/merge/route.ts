import { z } from "zod";
import { sql } from "@/lib/server/db";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { loadTask, loadTaskRow } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";
import { track } from "@/lib/server/track";

/** Merge a suggested duplicate into another task: this one is dismissed (pointing at `into`), `into` is kept. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/tasks/[id]/merge">) => {
  const { into } = z.object({ into: z.uuid() }).parse(await readJson(req));
  const { user, session } = await requireReady();
  const { id } = await ctx.params;
  if (id === into) throw new HttpError(400, "same_task", "A task can't be merged into itself.");
  await loadTaskRow(user.id, id);
  await loadTaskRow(user.id, into);
  await sql`update tasks set status = 'dismissed', duplicate_of = ${into}, updated_at = now() where id = ${id} and user_id = ${user.id}`;
  // The kept task inherits any due date the duplicate had confirmed and it lacked.
  await sql`
    update tasks k set due_at = d.due_at, due_all_day = d.due_all_day, due_status = d.due_status, due_text = d.due_text, due_note = d.due_note, updated_at = now()
    from tasks d where k.id = ${into} and d.id = ${id} and k.due_at is null and d.due_at is not null`;
  await track("task_merged", { userId: user.id, sessionId: session.id });
  return json({ task: await loadTask(user.id, into) });
});
