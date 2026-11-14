import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { clearCookie, getSession } from "@/lib/server/session";

/** Sign out this browser session. Data stays with the account. */
export const POST = handle(async () => {
  const session = await getSession(false);
  if (session) await sql`delete from sessions where id = ${session.id}`;
  await clearCookie();
  return json({ ok: true });
});
