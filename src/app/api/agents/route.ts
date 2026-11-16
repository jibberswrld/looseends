import { after } from "next/server";
import { z } from "zod";
import { createRun, executeRun, listRuns } from "@/lib/server/agents";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 300;

export const GET = handle(async () => {
  const { user } = await requireReady();
  return json({ runs: await listRuns(user.id) });
});

export const POST = handle(async (req: Request) => {
  const { task } = z.object({ task: z.string().trim().min(1).max(10_000) }).parse(await readJson(req));
  const ctx = await requireReady();
  await rateLimit(ctx.user.id, "agent");
  const run = await createRun(ctx.user.id, task);
  after(() => executeRun(ctx, run));
  return json({ run }, 202);
});
