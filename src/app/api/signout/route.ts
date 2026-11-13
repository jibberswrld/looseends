import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { writeCredential } from "@/lib/server/publik";
import { clearCookie } from "@/lib/server/session";

/** Sign out on this computer: forgets every browser session and this computer's publik key. Data stays with the account. */
export const POST = handle(async () => {
  await sql`delete from sessions`;
  writeCredential(null);
  await clearCookie();
  return json({ ok: true });
});
