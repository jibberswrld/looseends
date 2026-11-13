// publik module for LooseEnds: Sign in with publik, usage counting, and publik API as one provider option.
// Adapted from https://publikhq.com/sdk/publik.ts.md for a hosted web app (the "server the builder deploys" case):
// the server holds PUBLIK_APP_TOKEN, provisions one install per browser session (POST /api/v1/installs), keeps the
// pk_ key encrypted in the database (never in the browser bundle), shows the gate until GET /api/v1/wallet says
// "claimed", then sends app_opened / active_session usage events (POST /api/v1/telemetry).
import { randomUUID } from "node:crypto";
import pkg from "../../../package.json";

export const APP_SLUG = "looseends";
export const APP_VERSION: string = pkg.version;
/** LooseEnds calls a model, so the gate asks how the person pays for AI. */
export const USES_AI = true;
export const ORIGIN = process.env.PUBLIK_ORIGIN || "https://publikhq.com"; // PUBLIK_ORIGIN: tests only
export const DEFAULT_BASE_URL = `${ORIGIN}/api/v1`;
/** Ask for a tier, never a vendor model name. */
export const MODELS = { fast: "publik-fast", balanced: "publik-balanced", smart: "publik-smart" } as const;
export const POLL_MS = 3_000;
export const POLL_LIMIT_MS = 10 * 60_000;

export type Choice = "publik" | "own_key";
export type PublikOS = "macos" | "windows" | "linux";

export interface Wallet {
  claim_state: "anonymous" | "claimed";
  claim_url: string | null;
  account: { handle: string | null } | null;
  plan: { kind: "none" | "plan" | "pack"; label: string | null };
  balance_micros: number;
  top_up_url: string;
  linked_at: string | null;
}

export interface Installed {
  key: string;
  base_url: string;
  install_id: string;
  claim_url: string | null;
}

export class PublikUnreachable extends Error {}

function appToken(): string {
  return process.env.PUBLIK_APP_TOKEN?.trim() ?? "";
}
export function isConfigured(): boolean {
  return Boolean(process.env.PUBLIK_API_KEY) || appToken().startsWith("pat_");
}

function isOffline(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /abort|timeout/i.test(e.name));
}

/** POST /api/v1/installs: a publik key for one browser session. Throws a readable message. */
export async function provision(opts: { installId?: string; os: PublikOS; deviceName: string; priorKey?: string | null }): Promise<Installed> {
  const token = appToken();
  if (!token.startsWith("pat_")) throw new Error("This server has no publik app token.");
  let installId = opts.installId ?? randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ORIGIN}/api/v1/installs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          app_token: token, app_slug: APP_SLUG, app_version: APP_VERSION, os: opts.os,
          device_name: opts.deviceName.slice(0, 120), install_id: installId, disclosure_version: 1, dialects: ["chat_completions"],
        }),
      });
    } catch (e) {
      if (isOffline(e)) throw new PublikUnreachable("publik is not reachable. Check your connection.");
      throw e;
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const key: string | null = body.key ?? (res.status === 200 ? opts.priorKey ?? null : null);
    if ((res.status === 201 || res.status === 200) && key) {
      return { key, base_url: body.base_url ?? DEFAULT_BASE_URL, install_id: body.install_id ?? installId, claim_url: body.claim_url ?? null };
    }
    if (res.status === 200 || body.error?.type === "install_revoked") { installId = randomUUID(); continue; }
    throw new Error(body.error?.message ?? `publik could not set up this browser (${res.status}).`);
  }
  throw new Error("publik could not set up this browser.");
}

/** GET /api/v1/wallet. 401: the key is gone (null wallet). Throws PublikUnreachable when publik does not answer. */
export async function readWallet(key: string): Promise<{ status: number; wallet: Wallet | null; message: string | null }> {
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}/api/v1/wallet`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    if (isOffline(e)) throw new PublikUnreachable("publik is not reachable. Check your connection.");
    throw e;
  }
  const b = (await res.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok || typeof b.claim_state !== "string") return { status: res.status, wallet: null, message: b.error?.message ?? null };
  return {
    status: res.status, message: null,
    wallet: { ...b, account: b.account ?? null, plan: b.plan ?? { kind: "none", label: null }, balance_micros: b.balance_micros ?? 0 } as Wallet,
  };
}

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** The words of the gate. The same as every publik module (gateScreen() in publik.ts.md). */
export function gateWords(id: "unreachable" | "sign_in" | "choose", w: Wallet | null, message?: string): { title: string; body: string } {
  if (id === "unreachable") return { title: "Sign in with publik", body: message ?? "publik is not reachable. Check your connection." };
  if (id === "sign_in") return { title: "Sign in with publik", body: "This app uses your publik account. Click Sign in with publik, then sign in in your browser. This window continues when you are signed in." };
  const who = w?.account?.handle ? `You are signed in as @${w.account.handle}.` : "You are signed in to publik.";
  if (!w || (w.plan.kind === "none" && w.balance_micros === 0)) return { title: "Choose how to pay for AI", body: `${who} This app uses AI. Get a publik plan, or use your own key.` };
  const what = w.plan.kind === "plan" ? `Your plan: ${w.plan.label ?? "publik"}.` : `Your balance: ${dollars(w.balance_micros)}.`;
  return { title: "Connect your plan", body: `${who} ${what} Connect it to use AI in this app, or use your own key.` };
}

// ---------- usage counting ----------
function usageOff(): boolean {
  const dnt = (process.env.DO_NOT_TRACK ?? "").trim().toLowerCase();
  if (dnt !== "" && dnt !== "0" && dnt !== "false") return true;
  return ["0", "false", "off"].includes((process.env.PUBLIK_TELEMETRY ?? "").trim().toLowerCase());
}

/** POST /api/v1/telemetry with the install key and no content. Never throws. */
export async function sendEvent(event: "app_opened" | "active_session", s: { key: string; telemetryId: string; os: PublikOS }): Promise<number | null> {
  if (usageOff()) return null;
  try {
    const body = { v: 1, app: APP_SLUG, install_id: s.telemetryId, event, app_version: APP_VERSION.replace(/^v/i, ""), os: s.os };
    const res = await fetch(process.env.PUBLIK_TELEMETRY_URL || `${ORIGIN}/api/v1/telemetry`, {
      method: "POST", signal: AbortSignal.timeout(5_000),
      headers: { "content-type": "application/json", ...(s.key.startsWith("pk_") ? { authorization: `Bearer ${s.key}` } : {}) },
      body: JSON.stringify(body),
    });
    if (process.env.PUBLIK_TELEMETRY_DEBUG === "1") process.stderr.write(`publik-telemetry: ${event} -> ${res.status}\n`);
    return res.status;
  } catch {
    return null;
  }
}

/** Builder check: PUBLIK_SELF_TEST=1 makes the server print this line at start-up and exit (see src/instrumentation.ts). */
export async function selfTest(): Promise<string> {
  try {
    const r = await readWallet((await provision({ os: "linux", deviceName: "LooseEnds self-test" })).key);
    if (!r.wallet) throw new Error(r.message ?? `GET /wallet answered ${r.status}`);
    return `publik self-test: ok ${APP_SLUG} ${APP_VERSION}`;
  } catch (e) {
    return `publik self-test: failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** A 402 renders its message plus exactly ONE link: this one. */
export function topUpUrlFrom402(body: unknown): { message: string; url: string | null } {
  const e = (body as { error?: { message?: string; top_up_url?: string } } | null)?.error;
  return { message: e?.message ?? "Not enough publik API balance.", url: e?.top_up_url ?? null };
}
