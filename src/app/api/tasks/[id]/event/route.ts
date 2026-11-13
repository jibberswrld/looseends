import { EventInput, prepareEvent } from "@/lib/server/actions";
import { handle, json, readJson } from "@/lib/server/http";
import { loadTask, loadTaskRow } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

/** Prepare a calendar event (suggested, not created). Export with GET /api/actions/:id/ics. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/tasks/[id]/event">) => {
  const input = EventInput.parse(await readJson(req));
  const c = await requireReady();
  const { id } = await ctx.params;
  await prepareEvent(c, await loadTaskRow(c.user.id, id), input);
  return json({ task: await loadTask(c.user.id, id) });
});
