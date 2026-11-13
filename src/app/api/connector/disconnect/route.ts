import { connectorSession, parseToolkit, upstream } from "@/lib/server/composio";
import { handle, json, readJson } from "@/lib/server/http";

/** Connector service: remove the caller's connected account(s) for one toolkit. */
export const POST = handle(async (req: Request) => {
  const toolkit = parseToolkit(((await readJson(req)) as { toolkit?: unknown }).toolkit);
  const { composio, userId } = await connectorSession(req);
  try {
    const { items } = await composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: [toolkit] });
    for (const account of items) await composio.connectedAccounts.delete(account.id);
    return json({ ok: true });
  } catch (e) {
    throw upstream(e);
  }
});
