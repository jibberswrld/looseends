import { connectionStatus, connectorSession, toolMetadata, upstream } from "@/lib/server/composio";
import { handle, HttpError, json, readJson } from "@/lib/server/http";

export const POST = handle(async (req: Request) => {
  const body = (await readJson(req)) as { query?: unknown; toolkits?: unknown };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 500) throw new HttpError(400, "invalid_request", "Give a short tool search query.");
  const { session, composio } = await connectorSession(req);
  try {
    const connected = (await connectionStatus(session)).apps.filter((a) => a.connected).map((a) => a.slug);
    const wanted = Array.isArray(body.toolkits) ? body.toolkits.filter((t): t is string => typeof t === "string" && connected.includes(t)) : connected;
    if (!wanted.length) return json({ tools: [] });
    const found = await session.search({ query, toolkits: wanted });
    const slugs = [...new Set(found.results.flatMap((r) => [...r.primaryToolSlugs, ...r.relatedToolSlugs]))].slice(0, 24);
    const tools = [];
    for (const slug of slugs) {
      if (tools.length >= 8) break;
      try {
        const meta = await toolMetadata(composio, slug);
        if (wanted.includes(meta.toolkit)) {
          const parameters = JSON.parse(JSON.stringify(meta.parameters, (key, value) => {
            if (key === "examples" || key === "title") return undefined;
            return key === "description" && typeof value === "string" ? value.slice(0, 240) : value;
          })) as Record<string, unknown>;
          tools.push({ ...meta, parameters });
        }
      } catch (e) {
        if (!(e instanceof HttpError && e.code === "tool_not_allowed")) throw e;
      }
    }
    return json({ tools });
  } catch (e) {
    throw upstream(e);
  }
});
