import { connectionStatus, connectorSession, upstream } from "@/lib/server/composio";
import { handle, json } from "@/lib/server/http";

/** Connector service: which of the caller's accounts are connected. */
export const GET = handle(async (req: Request) => {
  const { session } = await connectorSession(req);
  try {
    return json(await connectionStatus(session));
  } catch (e) {
    throw upstream(e);
  }
});
