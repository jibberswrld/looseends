import { z } from "zod";
import { connectorError, connectorLink } from "@/lib/server/connector";
import { handle, json, readJson } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";
import { track } from "@/lib/server/track";

/** A Google sign-in link to open in a new tab. Poll GET /api/connections until it shows connected. */
export const POST = handle(async (req: Request) => {
  const { toolkit } = z.object({ toolkit: z.enum(["gmail", "googlecalendar"]) }).parse(await readJson(req));
  const { user, session } = await requireReady();
  const r = await connectorLink(toolkit);
  if (!r.ok) throw connectorError(r, toolkit);
  await track("connection_linked", { userId: user.id, sessionId: session.id, props: { toolkit } });
  return json({ url: r.data.url });
});
