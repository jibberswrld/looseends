import { loadConnections } from "@/lib/server/connections";
import { handle, json } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";

/** Which accounts are connected. `available: false` (with a message) when the connector can't be reached. */
export const GET = handle(async () => {
  const { user } = await requireReady();
  return json(await loadConnections(user));
});
