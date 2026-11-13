import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { loadActionRow, loadTask } from "@/lib/server/repo";
import { sendAction } from "@/lib/server/send";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 90;

/** Send a reply with the user's Gmail, or add an event to their Google Calendar. Needs {confirm: true}. Sends at most once. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/actions/[id]/send">) => {
  const body = (await readJson(req)) as { confirm?: unknown };
  if (body.confirm !== true) throw new HttpError(400, "confirm_required", "Confirm before LooseEnds sends anything.");
  const c = await requireReady();
  const { id } = await ctx.params;
  const action = await loadActionRow(c.user.id, id);
  await sendAction(c, action);
  return json({ task: await loadTask(c.user.id, action.task_id) });
});
