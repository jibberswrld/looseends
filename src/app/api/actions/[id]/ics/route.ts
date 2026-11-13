import { buildIcs } from "@/lib/server/actions";
import { handle, HttpError } from "@/lib/server/http";
import { loadActionRow } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

/** Download the prepared event as an .ics file. Nothing is written to any calendar. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/actions/[id]/ics">) => {
  const { user } = await requireReady();
  const { id } = await ctx.params;
  const a = await loadActionRow(user.id, id);
  if (a.kind !== "event") throw new HttpError(400, "not_event", "Only calendar events can be downloaded.");
  const name = String(a.payload.title || "event").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "event";
  return new Response(buildIcs(a, user.timezone || "UTC"), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "")}.ics"; filename*=UTF-8''${encodeURIComponent(name)}.ics`,
      "cache-control": "no-store",
    },
  });
});
