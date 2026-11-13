import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { decrypt, randomToken, sha256 } from "./crypto";
import { sql, type Row } from "./db";
import { HttpError } from "./http";
import { PublikUnreachable, readWallet, type PublikOS } from "./publik";
import { track } from "./track";

export const COOKIE = "le_sid";
const WALLET_RECHECK_MS = 10 * 60_000;

export interface Ctx {
  session: Row;
  user: Row;
}

export function osFromUA(ua: string): PublikOS {
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(ua)) return "macos";
  return "linux";
}

export function deviceName(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "web";
  return `Web browser (${browser} on ${os})`;
}

/** The current browser session row. With create, makes one (and sets the cookie) when missing. */
export async function getSession(create: boolean): Promise<Row | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const rows = await sql`update sessions set last_seen_at = now() where id = ${sha256(raw)} returning *`;
    if (rows[0]) return rows[0];
  }
  if (!create) return null;
  const token = randomToken();
  const ua = (await headers()).get("user-agent") ?? "";
  const rows = await sql`
    insert into sessions (id, install_id, telemetry_id, os)
    values (${sha256(token)}, ${randomUUID()}, ${randomUUID()}, ${osFromUA(ua)})
    returning *`;
  jar.set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  return rows[0];
}

export async function clearCookie() {
  (await cookies()).delete(COOKIE);
}

export function sessionKey(s: Row): string | null {
  if (process.env.PUBLIK_API_KEY) return process.env.PUBLIK_API_KEY;
  return s.publik_key_enc ? decrypt(s.publik_key_enc) : null;
}

/** IANA timezone from the x-timezone header, validated. */
export async function requestTimezone(): Promise<string | null> {
  const tz = (await headers()).get("x-timezone");
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function gateError(): never {
  throw new HttpError(401, "gate", "Sign in with publik to continue.");
}

/** Every data route: the session must have passed the publik gate (claimed + AI choice made). */
export async function requireReady(): Promise<Ctx> {
  const session = await getSession(false);
  if (!session || session.claim_state !== "claimed" || !session.ai_choice || !session.user_id) gateError();

  // Re-verify the claim with publik at most every 10 minutes. If publik is unreachable, keep going.
  const checked = session.wallet_checked_at ? new Date(session.wallet_checked_at).getTime() : 0;
  if (Date.now() - checked > WALLET_RECHECK_MS) {
    const key = sessionKey(session);
    if (!key) gateError();
    try {
      const r = await readWallet(key);
      if (r.status === 401 || (r.wallet && r.wallet.claim_state !== "claimed")) {
        await sql`update sessions set claim_state = 'anonymous', user_id = null, wallet_checked_at = now() where id = ${session.id}`;
        if (r.status === 401) await sql`update sessions set publik_key_enc = null where id = ${session.id}`;
        gateError();
      }
      await sql`update sessions set wallet_checked_at = now() where id = ${session.id}`;
    } catch (e) {
      if (!(e instanceof PublikUnreachable)) throw e;
    }
  }

  const tz = await requestTimezone();
  const users = tz
    ? await sql`update users set last_seen_at = now(), timezone = ${tz} where id = ${session.user_id} returning *`
    : await sql`update users set last_seen_at = now() where id = ${session.user_id} returning *`;
  const user = users[0];
  if (!user) gateError();

  // Return-behaviour metric: one day_active per user per calendar day (user's timezone).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone || "UTC" }).format(new Date());
  const lastDay = user.last_active_day ? new Date(user.last_active_day).toISOString().slice(0, 10) : null;
  if (lastDay !== today) {
    const updated = await sql`update users set last_active_day = ${today} where id = ${user.id} and (last_active_day is distinct from ${today}::date) returning id`;
    if (updated[0]) {
      const created = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone || "UTC" }).format(new Date(user.created_at));
      await track("day_active", { userId: user.id, sessionId: session.id, props: { returning: created !== today } });
    }
  }
  return { session, user };
}
