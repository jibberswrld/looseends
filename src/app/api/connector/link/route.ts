import { connectorSession, parseToolkit, upstream } from "@/lib/server/composio";
import { handle, json, readJson } from "@/lib/server/http";

/** Connector service: a Google sign-in link for one toolkit. The user ends on /connected. */
export const POST = handle(async (req: Request) => {
  const toolkit = parseToolkit(((await readJson(req)) as { toolkit?: unknown }).toolkit);
  const { session } = await connectorSession(req);
  try {
    const request = await session.authorize(toolkit, { callbackUrl: `${new URL(req.url).origin}/connected?app=${toolkit}` });
    if (!request.redirectUrl) throw new Error("no redirectUrl");
    return json({ url: request.redirectUrl });
  } catch (e) {
    throw upstream(e);
  }
});
