// Client for the LooseEnds connector service (src/app/api/connector/**, hosted). It holds the Composio key;
// this computer proves who it is with its publik key. Nothing here ever throws for a connector that is down.
import type { Toolkit } from "@/lib/types";
import { HttpError } from "./http";
import { installKey } from "./publik";

const ORIGIN = (process.env.CONNECTOR_ORIGIN || "https://looseends-taupe.vercel.app").replace(/\/$/, "");
export const UNAVAILABLE = "Gmail and Calendar connections aren't available right now. Try again in a moment.";

export type ConnectorResult<T> =
  | { ok: true; data: T }
  /** unavailable: unreachable, not configured, or it timed out. `maybeDone`: the request left before the failure. */
  | { ok: false; kind: "unavailable" | "not_connected" | "error"; code: string; message: string; maybeDone: boolean };

async function call<T>(path: string, body: unknown | null, timeoutMs = 20_000): Promise<ConnectorResult<T>> {
  const fail = (kind: "unavailable" | "not_connected" | "error", code: string, message: string, maybeDone = false) =>
    ({ ok: false as const, kind, code, message, maybeDone });
  const key = installKey();
  if (!key) return fail("error", "gate", "Sign in with publik to continue.");
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}/api/connector/${path}`, {
      method: body === null ? "GET" : "POST",
      headers: { authorization: `Bearer ${key}`, ...(body === null ? {} : { "content-type": "application/json" }) },
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // A timeout can fire after the connector already acted; a refused connection cannot.
    return fail("unavailable", "unavailable", UNAVAILABLE, e instanceof Error && /abort|timeout/i.test(e.name));
  }
  const parsed = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (res.ok && parsed) return { ok: true, data: parsed };
  const code = parsed?.error?.code ?? "connector_error";
  const message = parsed?.error?.message ?? UNAVAILABLE;
  if (res.status === 409 && code === "not_connected") return fail("not_connected", code, message);
  if (res.status === 503 || res.status === 404 || !parsed) return fail("unavailable", code, code === "connector_not_configured" ? message : UNAVAILABLE);
  // "tool_failed" is Google saying no. Any other 5xx may have happened after the action went out.
  return fail("error", code, message, res.status >= 500 && code !== "tool_failed");
}

export const connectorStatus = () => call<Record<Toolkit, boolean>>("status", null);
export const connectorLink = (toolkit: Toolkit) => call<{ url: string }>("link", { toolkit });
export const connectorDisconnect = (toolkit: Toolkit) => call<{ ok: true }>("disconnect", { toolkit });
/** Run one tool. The connector enforces the allowlist; this app only ever asks for the five it needs. */
export const connectorRun = (tool: string, args: Record<string, unknown>) => call<{ data: Record<string, unknown> }>("run", { tool, arguments: args }, 60_000);

/** For routes where a connector failure is the response. */
export function connectorError(r: Extract<ConnectorResult<unknown>, { ok: false }>, toolkit: Toolkit): HttpError {
  if (r.kind === "not_connected") return new HttpError(409, "not_connected", toolkit === "gmail" ? "Connect Gmail first." : "Connect Google Calendar first.");
  if (r.kind === "unavailable") return new HttpError(503, "unavailable", r.message);
  return new HttpError(r.code === "gate" ? 401 : 502, r.code, r.message);
}
