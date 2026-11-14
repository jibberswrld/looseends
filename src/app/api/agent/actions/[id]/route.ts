import { z } from "zod";
import { agentResponse, decideAction } from "@/lib/server/agent";
import { handle, readJson } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 300;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { decision, args } = z.object({ decision: z.enum(["approve", "cancel"]), args: z.record(z.string(), z.unknown()).optional() }).parse(await readJson(req));
  const ready = await requireReady();
  const { id } = await ctx.params;
  return agentResponse((emit) => decideAction(ready, id, decision, args, emit));
});
