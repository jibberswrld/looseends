import { headers } from "next/headers";
import type { GateInfo } from "@/lib/types";
import { encrypt } from "./crypto";
import { sql, type Row } from "./db";
import { HttpError } from "./http";
import {
  gateWords, isConfigured, ORIGIN, provision, PublikUnreachable, readWallet, USES_AI, type PublikOS, type Wallet,
} from "./publik";
import { deviceName, requestTimezone, sessionKey } from "./session";
import { track } from "./track";

const hasPlanOf = (w: Wallet | null) => !!w && (w.plan.kind !== "none" || w.balance_micros > 0);

function info(state: GateInfo["state"], w: Wallet | null, s: Row | null, extra: Partial<GateInfo> = {}): GateInfo {
  return {
    state,
    title: "Sign in with publik",
    body: "",
    note: null,
    claimUrl: null,
    topUpUrl: w?.top_up_url ?? null,
    handle: w?.account?.handle ?? null,
    plan: w ? w.plan : null,
    balanceMicros: w ? w.balance_micros : null,
    choice: (s?.ai_choice as GateInfo["choice"]) ?? null,
    hasPlan: hasPlanOf(w),
    ...extra,
  };
}

/** Load or provision this session's publik key. */
async function ensureKey(s: Row): Promise<string> {
  const existing = sessionKey(s);
  if (existing) return existing;
  const ua = (await headers()).get("user-agent") ?? "";
  const inst = await provision({ installId: s.install_id, os: s.os as PublikOS, deviceName: deviceName(ua) });
  await sql`
    update sessions set publik_key_enc = ${encrypt(inst.key)}, publik_base_url = ${inst.base_url},
      install_id = ${inst.install_id}, claim_url = ${inst.claim_url}
    where id = ${s.id}`;
  s.install_id = inst.install_id;
  s.claim_url = inst.claim_url;
  s.publik_base_url = inst.base_url;
  return inst.key;
}

/** Link a claimed session to its LooseEnds user (keyed by publik handle, so data follows the person across devices). */
async function linkUser(s: Row, w: Wallet): Promise<Row> {
  const tz = await requestTimezone();
  const handle = w.account?.handle ?? null;
  let user: Row | undefined;
  if (handle) {
    user = (await sql`
      insert into users (publik_handle, timezone) values (${handle}, ${tz})
      on conflict (publik_handle) do update set last_seen_at = now(), timezone = coalesce(${tz}, users.timezone)
      returning *`)[0];
  } else if (s.user_id) {
    user = (await sql`select * from users where id = ${s.user_id}`)[0];
  }
  if (!user) user = (await sql`insert into users (timezone) values (${tz}) returning *`)[0];
  const wasClaimed = s.claim_state === "claimed" && s.user_id === user.id;
  await sql`update sessions set user_id = ${user.id}, claim_state = 'claimed', wallet_checked_at = now() where id = ${s.id}`;
  if (!wasClaimed) await track("signin_completed", { userId: user.id, sessionId: s.id });
  s.user_id = user.id;
  s.claim_state = "claimed";
  return user;
}

/** The gate, one step per call. The client polls GET /api/gate every 3 s while the sign-in screen is up. */
export async function computeGate(s: Row): Promise<GateInfo> {
  if (!isConfigured()) {
    return info("not_configured", null, s, { body: "LooseEnds is not connected to publik yet. Please try again later." });
  }
  let w: Wallet | null = null;
  try {
    for (let attempt = 0; ; attempt++) {
      const key = await ensureKey(s);
      const r = await readWallet(key);
      if (r.status === 401 && !process.env.PUBLIK_API_KEY && attempt === 0) {
        // A revoked key: provision again.
        await sql`update sessions set publik_key_enc = null, claim_state = 'anonymous', user_id = null where id = ${s.id}`;
        s.publik_key_enc = null;
        continue;
      }
      if (!r.wallet) {
        return info("unreachable", null, s, gateWords("unreachable", null, r.message ?? undefined));
      }
      w = r.wallet;
      break;
    }
  } catch (e) {
    if (e instanceof PublikUnreachable) return info("unreachable", null, s, gateWords("unreachable", null));
    return info("unreachable", null, s, gateWords("unreachable", null, e instanceof Error ? e.message : String(e)));
  }

  if (w.claim_state !== "claimed") {
    if (s.claim_state === "claimed") await sql`update sessions set claim_state = 'anonymous', user_id = null where id = ${s.id}`;
    return info("sign_in", w, s, { ...gateWords("sign_in", w), claimUrl: w.claim_url ?? s.claim_url ?? `${ORIGIN}/wallet` });
  }

  await linkUser(s, w);
  if (USES_AI && !s.ai_choice) return info("choose", w, s, gateWords("choose", w));
  return info("ready", w, s, { title: "You're signed in", body: "" });
}

/** POST /api/gate/choice: store how this browser pays for AI. */
export async function setChoice(s: Row, choice: "publik" | "own_key" | null) {
  await sql`update sessions set ai_choice = ${choice} where id = ${s.id}`;
  s.ai_choice = choice;
}

export async function freshWallet(s: Row): Promise<Wallet> {
  const key = sessionKey(s);
  if (!key) throw new HttpError(401, "gate", "Sign in with publik to continue.");
  try {
    const r = await readWallet(key);
    if (!r.wallet || r.wallet.claim_state !== "claimed") throw new HttpError(401, "gate", "Sign in with publik to continue.");
    return r.wallet;
  } catch (e) {
    if (e instanceof PublikUnreachable) throw new HttpError(503, "unreachable", e.message);
    throw e;
  }
}

export { hasPlanOf };
