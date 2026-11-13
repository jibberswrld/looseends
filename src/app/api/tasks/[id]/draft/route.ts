import { z } from "zod";
import { draftReply } from "@/lib/server/actions";
import { handle, json, readJson } from "@/lib/server/http";
import { loadTask, loadTaskRow } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 60;

/** Prepare (or revise) a reply draft. Never sends anything. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/tasks/[id]/draft">) => {
  const { instruction } = z.object({ instruction: z.string().trim().max(500).nullable().optional() }).parse(await readJson(req));
  const c = await requireReady();
  const { id } = await ctx.params;
  await draftReply(c, await loadTaskRow(c.user.id, id), instruction || null);
  return json({ task: await loadTask(c.user.id, id) });
});
