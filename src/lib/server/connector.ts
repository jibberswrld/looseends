import { headers } from "next/headers";
import type { ConnectorApp, Toolkit } from "@/lib/types";
import { connectionStatus, connectorCaller, connectorSession, parseToolkit, slimEmails, toolMetadata, upstream, type ConnectorTool } from "./composio";
import { requestSignal } from "./deadline";
import { HttpError } from "./http";
import { requireReady } from "./session";

export const UNAVAILABLE = "App connections aren't available right now. Try again in a moment.";
export type ConnectorResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "unavailable" | "not_connected" | "error"; code: string; message: string; maybeDone: boolean };

/** The existing mock server is reachable only in an isolated local installation, never on Vercel. */
function mockOrigin(): string | null {
  if (!process.env.CONNECTOR_ORIGIN || process.env.VERCEL || process.env.DATABASE_URL || !process.env.LOOSEENDS_DATA_DIR) return null;
  const url = new URL(process.env.CONNECTOR_ORIGIN);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Connector mock must be on loopback.");
  return url.origin;
}

async function disconnectAll(user: Awaited<ReturnType<typeof requireReady>>["user"], toolkit: Toolkit | undefined, signal: AbortSignal) {
  const { composio, userId } = connectorCaller(user);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await composio.connectedAccounts.list({ userIds: [userId], ...(toolkit ? { toolkitSlugs: [toolkit] } : {}), cursor, limit: 100 }, { signal });
    ids.push(...page.items.map((account) => account.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  for (const id of ids) await composio.connectedAccounts.delete(id, { signal });
}

async function call<T>(path: string, body: Record<string, unknown> | null, timeoutMs = 20_000): Promise<ConnectorResult<T>> {
  let executing = false;
  try {
    const { user } = await requireReady();
    const signal = requestSignal(timeoutMs);
    const mock = mockOrigin();
    if (mock) {
      executing = path === "run";
      const res = await fetch(`${mock}/api/connector/${path}`, {
        method: body === null ? "GET" : "POST", redirect: "error", signal,
        headers: { "x-mock-user": `looseends_${user.publik_handle}`, "content-type": "application/json" },
        body: body === null ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new HttpError(res.status, data.error?.code ?? "connector_error", data.error?.message ?? UNAVAILABLE);
      return { ok: true, data };
    }
    let data: unknown;
    if (path === "disconnect" || path === "disconnect-all") {
      await disconnectAll(user, path === "disconnect" ? parseToolkit(body?.toolkit) : undefined, signal);
      data = { ok: true };
    } else {
      const { session, composio } = await connectorSession(user, signal);
      if (path === "status") data = await connectionStatus(session, signal);
      else if (path === "link") {
        const toolkit = parseToolkit(body?.toolkit);
        const h = await headers();
        const origin = `${process.env.VERCEL ? "https" : "http"}://${h.get("host")}`;
        const link = await session.authorize(toolkit, { callbackUrl: `${origin}/connected?app=${toolkit}` }, { signal });
        if (!link.redirectUrl) throw new Error("Missing authorization URL");
        data = { url: link.redirectUrl };
      } else if (path === "tools") {
        const query = typeof body?.query === "string" ? body.query.trim() : "";
        if (!query || query.length > 500) throw new HttpError(400, "invalid_request", "Give a short tool search query.");
        const connected = (await connectionStatus(session, signal)).apps.filter((a) => a.connected).map((a) => a.slug);
        const wanted = Array.isArray(body?.toolkits) ? body.toolkits.filter((t): t is string => typeof t === "string" && connected.includes(t)) : connected;
        const tools: ConnectorTool[] = [];
        if (wanted.length) {
          const found = await session.search({ query, toolkits: wanted }, { signal });
          const slugs = [...new Set(found.results.flatMap((r) => [...r.primaryToolSlugs, ...r.relatedToolSlugs]))].slice(0, 24);
          for (const slug of slugs) {
            if (tools.length >= 8) break;
            try {
              const meta = await toolMetadata(composio, slug, signal);
              if (wanted.includes(meta.toolkit)) tools.push(meta);
            } catch (e) {
              if (!(e instanceof HttpError && e.code === "tool_not_allowed")) throw e;
            }
          }
        }
        data = { tools };
      } else if (path === "run") {
        const tool = typeof body?.tool === "string" ? body.tool : "";
        if (!tool || tool.length > 150) throw new HttpError(400, "invalid_request", "Choose a tool.");
        const meta = await toolMetadata(composio, tool, signal);
        if (!(await connectionStatus(session, signal)).apps.some((a) => a.slug === meta.toolkit && a.connected)) throw new HttpError(409, "not_connected", `Connect ${meta.toolkit} first.`);
        const args = body?.arguments as Record<string, unknown>;
        executing = true;
        const result = await session.execute(meta.slug, meta.toolkit === "gmail" ? { ...args, user_id: "me" } : args, undefined, { signal });
        if (result.resultType !== "completed") throw new HttpError(502, "tool_failed", "The connected app couldn't complete that. Please try again.");
        const output = tool === "GMAIL_FETCH_EMAILS" ? slimEmails(result.data) : result.data;
        const serialized = JSON.stringify(output);
        data = { data: serialized.length > 200_000 ? { truncated: true, result: serialized.slice(0, 200_000) } : output };
      } else throw new Error("Unknown connector operation");
    }
    return { ok: true, data: data as T };
  } catch (e) {
    const error = upstream(e);
    return { ok: false, kind: error.code === "not_connected" ? "not_connected" : error.status === 503 ? "unavailable" : "error", code: error.code, message: error.message, maybeDone: executing && error.code !== "tool_failed" && error.status >= 500 };
  }
}

export const connectorStatus = () => call<{ gmail: boolean; googlecalendar: boolean; apps: ConnectorApp[]; [toolkit: string]: boolean | ConnectorApp[] }>("status", null);
export const connectorLink = (toolkit: Toolkit) => call<{ url: string }>("link", { toolkit });
export const connectorDisconnect = (toolkit: Toolkit) => call<{ ok: true }>("disconnect", { toolkit });
export const connectorDisconnectAll = () => call<{ ok: true }>("disconnect-all", {}, 60_000);
export const connectorTools = (query: string, toolkits?: Toolkit[]) => call<{ tools: ConnectorTool[] }>("tools", { query, toolkits }, 40_000);
export const connectorRun = (tool: string, args: Record<string, unknown>) => call<{ data: Record<string, unknown> }>("run", { tool, arguments: args }, 60_000);

export function connectorError(r: Extract<ConnectorResult<unknown>, { ok: false }>, toolkit: Toolkit): HttpError {
  if (r.kind === "not_connected") return new HttpError(409, "not_connected", `Connect ${toolkit} first.`);
  if (r.kind === "unavailable") return new HttpError(503, "unavailable", r.message);
  return new HttpError(r.code === "gate" ? 401 : 502, r.code, r.message);
}
