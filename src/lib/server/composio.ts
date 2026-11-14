// Server-only Composio access; no public bearer-key connector.
import { Composio, ToolRouterSession } from "@composio/core";
import type { ConnectorApp, Toolkit } from "@/lib/types";
import type { Row } from "./db";
import { HttpError } from "./http";

export const TOOLKITS: Toolkit[] = ["gmail", "googlecalendar", "outlook", "slack", "notion", "googledrive", "googledocs", "googlesheets", "github", "linear", "todoist"];
export interface ConnectorTool {
  slug: string;
  toolkit: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
}

/** Only a signed-in LooseEnds user row determines the Composio identity. */
export function connectorCaller(user: Row) {
  if (!user.publik_handle) throw new HttpError(401, "gate", "Sign in with publik to connect your accounts.");
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new HttpError(503, "connector_not_configured", "App connections aren't switched on yet.");
  return { userId: `looseends_${user.publik_handle}`, composio: new Composio({ apiKey }) };
}

export async function connectorSession(user: Row, signal: AbortSignal) {
  const { userId, composio } = connectorCaller(user);
  const session = await composio.create(userId, { toolkits: TOOLKITS }, { signal });
  // SDK 0.29's Session interface omits cancellation arguments present on its runtime class.
  if (!(session instanceof ToolRouterSession)) throw new Error("Unexpected Composio session");
  return { userId, composio, session };
}
type Session = Awaited<ReturnType<typeof connectorSession>>["session"];

/** A Composio failure, without leaking its details to the caller. */
export function upstream(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  console.error("[connector] upstream request failed");
  return new HttpError(502, "connector_error", "The connected app didn't answer. Please try again in a moment.");
}

export async function connectionStatus(session: Session, signal: AbortSignal): Promise<{ gmail: boolean; googlecalendar: boolean; apps: ConnectorApp[]; [toolkit: string]: boolean | ConnectorApp[] }> {
  const { items } = await session.toolkits({ toolkits: TOOLKITS }, { signal });
  const apps = TOOLKITS.map((slug) => {
    const item = items.find((i) => i.slug.toLowerCase() === slug);
    return { slug, name: item?.name ?? slug, logo: item?.logo ?? null, connected: item?.connection?.isActive === true };
  });
  return { ...Object.fromEntries(apps.map((a) => [a.slug, a.connected])), gmail: apps[0].connected, googlecalendar: apps[1].connected, apps };
}

export function parseToolkit(v: unknown): Toolkit {
  if (typeof v === "string" && TOOLKITS.includes(v)) return v;
  throw new HttpError(400, "invalid_request", "Unsupported app.");
}

export async function toolMetadata(composio: Composio, slug: string, signal: AbortSignal): Promise<ConnectorTool> {
  const tool = await composio.tools.getRawComposioToolBySlug(slug, undefined, { signal });
  const toolkit = tool.toolkit?.slug?.toLowerCase() ?? "";
  if (!TOOLKITS.includes(toolkit)) throw new HttpError(403, "tool_not_allowed", "LooseEnds can't use that tool.");
  const tags = tool.tags ?? [];
  return {
    slug: tool.slug, toolkit, name: tool.name, description: tool.description ?? "",
    parameters: tool.inputParameters as Record<string, unknown>,
    readOnly: tags.includes("readOnlyHint") && !tags.includes("destructiveHint") && !tags.includes("createHint") && !tags.includes("updateHint"),
  };
}

// ---------- GMAIL_FETCH_EMAILS: keep the reply small ----------
const BODY_LIMIT = 8_000;
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };

function partText(p: Part | undefined, mime: string): string {
  if (!p) return "";
  if (p.mimeType === mime && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  for (const c of p.parts ?? []) {
    const t = partText(c, mime);
    if (t) return t;
  }
  return "";
}

/**
 * A full Gmail payload (HTML, inline images) per message can exceed what one response may carry. Send back the same
 * message objects minus `payload` and `attachmentList`, with `messageText` filled from the payload when it is empty.
 */
export function slimEmails(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.messages)) return data;
  return {
    ...data,
    messages: data.messages.map((m: Record<string, unknown>) => {
      const { payload, ...rest } = m;
      delete rest.attachmentList;
      const own = typeof m.messageText === "string" ? m.messageText : "";
      const text = own.trim() ? own : partText(payload as Part, "text/plain") || partText(payload as Part, "text/html");
      return { ...rest, messageText: text.slice(0, BODY_LIMIT) };
    }),
  };
}
