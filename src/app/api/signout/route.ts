import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { clearCookie, getSession } from "@/lib/server/session";

/** Forget this browser: deletes the session (and its publik install key). Data stays with the account. */
export const POST = handle(async () => {
  const s = await getSession(false);
  if (s) await sql`delete from sessions where id = ${s.id}`;
  await clearCookie();
  return json({ ok: true });
});
