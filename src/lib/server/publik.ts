// publik module for LooseEnds: Sign in with publik, usage counting, and publik API as one provider option.
// Adapted from https://publikhq.com/sdk/publik.ts.md for a local web app ("runs in the browser, locally"):
// the Next.js server is the app's main process. It provisions this computer's key (POST /api/v1/installs) with the
// committed public app token, keeps it in publik's per-app credential file (mode 0600, never sent to the browser),
// shows the gate until GET /api/v1/wallet says "claimed", then sends app_opened / active_session usage events
// (POST /api/v1/telemetry) with no content.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, platform } from "node:os";
import { dirname, join } from "node:path";
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

export const OS: PublikOS = ({ darwin: "macos", win32: "windows" } as Record<string, PublikOS>)[platform()] ?? "linux";
const ARCH = arch() === "arm64" || arch() === "x64" ? { arch: arch() } : {};

/** The public app token: PUBLIK_APP_TOKEN, else publik-app-token.txt in the app folder or a parent. */
function appToken(): string {
  const env = process.env.PUBLIK_APP_TOKEN?.trim();
  if (env) return env;
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const file = join(dir, "publik-app-token.txt");
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    if (dirname(dir) === dir) return "";
  }
}

/** ~/Library/Application Support/publik, %LOCALAPPDATA%\\publik, ~/.config/publik: shared by every publik app. */
function publikDir(): string {
  const os = platform();
  const base = os === "darwin" ? join(homedir(), "Library", "Application Support")
    : os === "win32" ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
    : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "publik");
}
export const credentialPath = () => join(publikDir(), "apps", `${APP_SLUG}.json`);

export interface PublikCredential { key: string; base_url: string; install_id: string; claim_url: string | null }

export function readCredential(): PublikCredential | null {
  try {
    const c = JSON.parse(readFileSync(credentialPath(), "utf8")) as PublikCredential;
    return typeof c.key === "string" && c.key.startsWith("pk_") ? c : null;
  } catch { return null; }
}
export function writeCredential(c: PublikCredential | null): void {
  const file = credentialPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(c ?? {}, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** This computer's publik key: PUBLIK_API_KEY (development) or the credential file. */
export function installKey(): string | null {
  return process.env.PUBLIK_API_KEY || readCredential()?.key || null;
}
export function isConfigured(): boolean {
  return Boolean(process.env.PUBLIK_API_KEY) || appToken().startsWith("pat_");
}

function isOffline(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /abort|timeout/i.test(e.name));
}

/** POST /api/v1/installs: a publik key for one browser session. Throws a readable message. */
export async function provision(opts: { installId?: string; priorKey?: string | null } = {}): Promise<Installed> {
  const token = appToken();
  if (!token.startsWith("pat_")) throw new Error("This build has no publik app token. Ask the developer for a new build.");
  let installId = opts.installId ?? randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ORIGIN}/api/v1/installs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          app_token: token, app_slug: APP_SLUG, app_version: APP_VERSION, os: OS, ...ARCH,
          device_name: hostname().slice(0, 120), install_id: installId, disclosure_version: 1, dialects: ["chat_completions"],
        }),
      });
    } catch (e) {
      if (isOffline(e)) throw new PublikUnreachable("publik is not reachable. Check your connection.");
      throw e;
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const key: string | null = body.key ?? (res.status === 200 ? opts.priorKey ?? null : null);
    if ((res.status === 201 || res.status === 200) && key) {
      const c = { key, base_url: body.base_url ?? DEFAULT_BASE_URL, install_id: body.install_id ?? installId, claim_url: body.claim_url ?? null };
      writeCredential(c); // the key reaches disk before anything else sees it
      return c;
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
  if (["0", "false", "off"].includes((process.env.PUBLIK_TELEMETRY ?? "").trim().toLowerCase())) return true;
  try { return JSON.parse(readFileSync(join(publikDir(), "consent.json"), "utf8")).usage === false; } catch { return false; }
}

let installIdOnce: string | null = null;
/** One random UUID per computer account, shared by every publik app, in <publik dir>/telemetry.json (mode 0600). */
function telemetryInstallId(): string {
  const file = join(publikDir(), "telemetry.json");
  const saved = () => {
    try {
      const id = String(JSON.parse(readFileSync(file, "utf8")).install_id).toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : null;
    } catch { return null; }
  };
  if ((installIdOnce ??= saved())) return installIdOnce;
  const fresh = randomUUID();
  try {
    mkdirSync(publikDir(), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ install_id: fresh, created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z") }) + "\n", { flag: "wx", mode: 0o600 });
    return (installIdOnce = fresh);
  } catch { return (installIdOnce = saved() ?? fresh); } // another publik app saved its ID first
}

/** POST /api/v1/telemetry with the install key and no content. Never throws. */
export async function sendEvent(event: "app_opened" | "active_session", s: { key: string }): Promise<number | null> {
  if (usageOff()) return null;
  try {
    const body = { v: 1, app: APP_SLUG, install_id: telemetryInstallId(), event, app_version: APP_VERSION.replace(/^v/i, ""), os: OS, ...ARCH };
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
    const r = await readWallet((await provision({ installId: readCredential()?.install_id, priorKey: readCredential()?.key })).key);
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
