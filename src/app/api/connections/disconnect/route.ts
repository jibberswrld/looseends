import { z } from "zod";
import { loadConnections } from "@/lib/server/connections";
import { connectorDisconnect, connectorError } from "@/lib/server/connector";
import { handle, json, readJson } from "@/lib/server/http";
import { requireReady } from "@/lib/server/session";

export const POST = handle(async (req: Request) => {
  const { toolkit } = z.object({ toolkit: z.enum(["gmail", "googlecalendar"]) }).parse(await readJson(req));
  const { user } = await requireReady();
  const r = await connectorDisconnect(toolkit);
  if (!r.ok) throw connectorError(r, toolkit);
  return json(await loadConnections(user));
});
