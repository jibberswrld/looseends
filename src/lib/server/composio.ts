// The connector service half of LooseEnds. It runs only where COMPOSIO_API_KEY is set (the hosted deployment),
// never on a user's computer: the repo is public, so the Composio project key cannot ship with the app.
// The local app calls /api/connector/* server-to-server with this computer's publik key (see connector.ts).
import { Composio } from "@composio/core";
import type { ConnectorApp, Toolkit } from "@/lib/types";
import { sha256 } from "./crypto";
import { HttpError } from "./http";
import { PublikUnreachable, readWallet } from "./publik";

export const TOOLKITS: Toolkit[] = ["gmail", "googlecalendar", "outlook", "slack", "notion", "googledrive", "googledocs", "googlesheets", "github", "linear", "todoist"];
export interface ConnectorTool {
  slug: string;
  toolkit: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
}

const VERIFY_TTL_MS = 5 * 60_000;
const verified = new Map<string, { handle: string; until: number }>();

/** Bearer publik key -> the Composio user id for that publik account. 401 unless the key is claimed. */
async function verifyCaller(req: Request): Promise<string> {
  const unauthorized = () => new HttpError(401, "unauthorized", "Sign in with publik to connect your accounts.");
  const key = /^Bearer (pk_\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!key) throw unauthorized();
  const id = sha256(key);
  const hit = verified.get(id);
  if (hit && hit.until > Date.now()) return `looseends_${hit.handle}`;
  verified.delete(id);
  let handle: string | null | undefined;
  try {
    const { wallet } = await readWallet(key);
    handle = wallet?.claim_state === "claimed" ? wallet.account?.handle : null;
  } catch (e) {
    if (e instanceof PublikUnreachable) throw new HttpError(503, "unreachable", e.message);
    throw e;
  }
  if (!handle) throw unauthorized();
  if (verified.size > 5000) verified.clear();
  verified.set(id, { handle, until: Date.now() + VERIFY_TTL_MS });
  return `looseends_${handle}`;
}

/** Every connector route starts here: who is calling (401), and is this deployment the connector at all (503). */
export async function connectorCaller(req: Request) {
  const userId = await verifyCaller(req);
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new HttpError(503, "connector_not_configured", "App connections aren't switched on yet.");
  return { userId, composio: new Composio({ apiKey }) };
}

/** The caller plus a Composio session scoped to supported toolkits. */
export async function connectorSession(req: Request) {
  const { userId, composio } = await connectorCaller(req);
  try {
    return { userId, composio, session: await composio.create(userId, { toolkits: TOOLKITS }) };
  } catch (e) {
    throw upstream(e);
  }
}
type Session = Awaited<ReturnType<typeof connectorSession>>["session"];

/** A Composio failure, without leaking its details to the caller. */
export function upstream(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  console.error("[connector]", e instanceof Error ? `${e.name}: ${e.message}` : e);
  return new HttpError(502, "connector_error", "The connected app didn't answer. Please try again in a moment.");
}

export async function connectionStatus(session: Session): Promise<{ gmail: boolean; googlecalendar: boolean; apps: ConnectorApp[]; [toolkit: string]: boolean | ConnectorApp[] }> {
  const { items } = await session.toolkits({ toolkits: TOOLKITS });
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

export async function toolMetadata(composio: Composio, slug: string): Promise<ConnectorTool> {
  const tool = await composio.tools.getRawComposioToolBySlug(slug);
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
