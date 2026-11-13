import { z } from "zod";
import { agentResponse, clearMessages, converse, messages } from "@/lib/server/agent";
import { handle, json, readJson } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 300;

export const GET = handle(async () => {
  const { user } = await requireReady();
  return json({ messages: await messages(user.id) });
});

export const DELETE = handle(async () => {
  const { user } = await requireReady();
  await clearMessages(user.id);
  return json({ messages: [] });
});

export const POST = handle(async (req: Request) => {
  const { message } = z.object({ message: z.string().trim().min(1).max(10_000) }).parse(await readJson(req));
  const ctx = await requireReady();
  return agentResponse((emit) => converse(ctx, message, emit));
});
