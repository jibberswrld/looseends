import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { loadSourceRow, toSource } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/sources/[id]">) => {
  const { user } = await requireReady();
  const { id } = await ctx.params;
  return json(toSource(await loadSourceRow(user.id, id)));
});

/** Delete the source content and every task (and prepared action) that came from it. */
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/sources/[id]">) => {
  const { user } = await requireReady();
  const { id } = await ctx.params;
  await loadSourceRow(user.id, id);
  await sql`delete from sources where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
