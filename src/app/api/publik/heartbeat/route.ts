import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { sendEvent } from "@/lib/server/publik";
import { getSession, sessionKey } from "@/lib/server/session";

/** active_session: the client pings every 5 minutes while visible; publik gets one event per 30 minutes. */
export const POST = handle(async () => {
  const s = await getSession(false);
  const key = s && s.claim_state === "claimed" ? sessionKey(s) : null;
  if (s && key) {
    const due = await sql`update sessions set last_active_session_at = now() where id = ${s.id} and (last_active_session_at is null or last_active_session_at < now() - interval '30 minutes') returning id`;
    if (due[0]) await sendEvent("active_session", { key });
  }
  return json({ ok: true });
});
