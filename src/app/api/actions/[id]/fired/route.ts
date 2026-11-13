import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { loadActionRow } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

/** The client showed this reminder; don't show it again. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/actions/[id]/fired">) => {
  const { user } = await requireReady();
  const { id } = await ctx.params;
  await loadActionRow(user.id, id);
  await sql`update actions set fired_at = coalesce(fired_at, now()), updated_at = now() where id = ${id} and user_id = ${user.id} and kind = 'reminder'`;
  return json({ ok: true });
});
