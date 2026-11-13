import { z } from "zod";
import { ask } from "@/lib/server/ask";
import { handle, json, readJson } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 60;

/** Answer a question about the user's own queue. Read-only. */
export const POST = handle(async (req: Request) => {
  const { question } = z.object({ question: z.string().trim().min(1).max(500) }).parse(await readJson(req));
  return json(await ask(await requireReady(), question));
});
