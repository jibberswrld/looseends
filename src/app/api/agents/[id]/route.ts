import { loadRun } from "@/lib/server/agents";
import { handle, json } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireReady();
  return json(await loadRun(user.id, (await ctx.params).id));
});
