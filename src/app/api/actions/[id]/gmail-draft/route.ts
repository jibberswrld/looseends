import { handle, json } from "@/lib/server/http";
import { loadActionRow, loadTask } from "@/lib/server/repo";
import { saveGmailDraft } from "@/lib/server/send";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 90;

/** Save the reply as a draft in the user's Gmail. Nothing is sent; the action stays "prepared". */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/actions/[id]/gmail-draft">) => {
  const { user } = await requireReady();
  const { id } = await ctx.params;
  const action = await loadActionRow(user.id, id);
  await saveGmailDraft(action);
  return json({ task: await loadTask(user.id, action.task_id) });
});
