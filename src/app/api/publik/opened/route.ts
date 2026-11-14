import { sql } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { sendEvent } from "@/lib/server/publik";
import { getSession, sessionKey } from "@/lib/server/session";

/** app_opened: sent when the app shell loads after the gate (at most once per 30 minutes per session). */
export const POST = handle(async () => {
  const s = await getSession(false);
  const key = s && s.claim_state === "claimed" ? sessionKey(s) : null;
  if (s && key) {
    const due = await sql`update sessions set last_app_opened_at = now() where id = ${s.id} and (last_app_opened_at is null or last_app_opened_at < now() - interval '30 minutes') returning id`;
    if (due[0]) await sendEvent("app_opened", { key, telemetryId: s.telemetry_id, os: s.os });
  }
  return json({ ok: true });
});
