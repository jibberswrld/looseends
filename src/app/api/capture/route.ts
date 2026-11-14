import { rateLimit } from "@/lib/server/rate-limit";
import { capture, readCaptureInput } from "@/lib/server/capture";
import { handle, json } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 300;

/** Paste text (JSON) or upload an image / PDF (multipart `file`). Returns CaptureResult. */
export const POST = handle(async (req: Request) => {
  const ctx = await requireReady();
  await rateLimit(ctx.user.id, "capture");
  const input = await readCaptureInput(req);
  return json(await capture(ctx, input));
});
