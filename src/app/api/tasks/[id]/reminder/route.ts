import { prepareReminder, ReminderInput } from "@/lib/server/actions";
import { handle, json, readJson } from "@/lib/server/http";
import { loadTask, loadTaskRow } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

/** Schedule an in-app reminder. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/tasks/[id]/reminder">) => {
  const input = ReminderInput.parse(await readJson(req));
  const c = await requireReady();
  const { id } = await ctx.params;
  await prepareReminder(c, await loadTaskRow(c.user.id, id), input);
  return json({ task: await loadTask(c.user.id, id) });
});
