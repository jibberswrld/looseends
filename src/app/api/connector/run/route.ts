import { ALLOWED_TOOLS, connectionStatus, connectorCaller, connectorSession, slimEmails, upstream } from "@/lib/server/composio";
import { handle, HttpError, json, readJson } from "@/lib/server/http";

export const maxDuration = 60;

/** Connector service: run ONE allowlisted Gmail / Calendar tool for the caller. Everything else is refused. */
export const POST = handle(async (req: Request) => {
  const body = (await readJson(req)) as { tool?: unknown; arguments?: unknown };
  const tool = typeof body.tool === "string" ? body.tool : "";
  const toolkit = Object.hasOwn(ALLOWED_TOOLS, tool) ? ALLOWED_TOOLS[tool] : null;
  await connectorCaller(req);
  if (!toolkit) throw new HttpError(403, "tool_not_allowed", "LooseEnds can't do that."); // refused before Composio is ever called
  const { session } = await connectorSession(req);
  const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? (body.arguments as Record<string, unknown>) : {};
  try {
    if (!(await connectionStatus(session))[toolkit]) {
      throw new HttpError(409, "not_connected", toolkit === "gmail" ? "Connect Gmail first." : "Connect Google Calendar first.");
    }
    // Always the caller's own mailbox, whatever the request says.
    const result = await session.execute(tool, toolkit === "gmail" ? { ...args, user_id: "me" } : args);
    if (result.resultType !== "completed") {
      console.error("[connector]", tool, result.resultType, result.error);
      throw new HttpError(502, "tool_failed", "Google couldn't complete that. Please try again.");
    }
    return json({ data: tool === "GMAIL_FETCH_EMAILS" ? slimEmails(result.data) : result.data });
  } catch (e) {
    throw upstream(e);
  }
});
