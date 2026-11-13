import { connectionStatus, connectorSession, slimEmails, toolMetadata, upstream } from "@/lib/server/composio";
import { handle, HttpError, json, readJson } from "@/lib/server/http";

export const maxDuration = 60;

/** Connector service: run one tool belonging to a supported, connected app. */
export const POST = handle(async (req: Request) => {
  const body = (await readJson(req)) as { tool?: unknown; arguments?: unknown };
  const tool = typeof body.tool === "string" ? body.tool : "";
  if (!tool || tool.length > 150) throw new HttpError(400, "invalid_request", "Choose a tool.");
  const { session, composio } = await connectorSession(req);
  const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? (body.arguments as Record<string, unknown>) : {};
  try {
    const meta = await toolMetadata(composio, tool);
    if (!(await connectionStatus(session)).apps.some((a) => a.slug === meta.toolkit && a.connected)) {
      throw new HttpError(409, "not_connected", `Connect ${meta.toolkit} first.`);
    }
    // Always the caller's own mailbox, whatever the request says.
    const result = await session.execute(meta.slug, meta.toolkit === "gmail" ? { ...args, user_id: "me" } : args);
    if (result.resultType !== "completed") {
      console.error("[connector]", tool, result.resultType, result.error);
      throw new HttpError(502, "tool_failed", "The connected app couldn't complete that. Please try again.");
    }
    const data = tool === "GMAIL_FETCH_EMAILS" ? slimEmails(result.data) : result.data;
    const serialized = JSON.stringify(data);
    return json({ data: serialized.length > 200_000 ? { truncated: true, result: serialized.slice(0, 200_000) } : data });
  } catch (e) {
    throw upstream(e);
  }
});
