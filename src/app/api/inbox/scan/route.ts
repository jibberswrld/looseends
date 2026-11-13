import { handle } from "@/lib/server/http";
import { scanInbox } from "@/lib/server/inbox";
import { requireReady } from "@/lib/server/session";

export const maxDuration = 300;

/** Check the inbox. Streams one ScanEvent per line (NDJSON) as each email is read. */
export const POST = handle(async () => {
  const ctx = await requireReady();
  const events = scanInbox(ctx);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (e) {
        console.error("[scan]", e);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", code: "server_error", message: "Something went wrong while reading your inbox. Please try again." }) + "\n"));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined); // the tab closed: stop before the next email
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
  });
});
