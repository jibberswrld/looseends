import { writeCredential } from "@/lib/server/publik";
import { z } from "zod";
import type { Me } from "@/lib/types";
import { OWN_DEFAULT_BASE_URL, OWN_DEFAULT_MODEL, validateOwnKey } from "@/lib/server/ai";
import { decrypt, encrypt } from "@/lib/server/crypto";
import { sql, type Row } from "@/lib/server/db";
import { freshWallet, hasPlanOf } from "@/lib/server/gate";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { clearCookie, requireReady } from "@/lib/server/session";

function toMe(user: Row, session: Row): Me {
  let last4 = "";
  try { last4 = user.own_key_enc ? decrypt(user.own_key_enc).slice(-4) : ""; } catch { /* rotated secret */ }
  return {
    handle: user.publik_handle ?? null,
    timezone: user.timezone ?? null,
    choice: session.ai_choice ?? null,
    ownKey: user.own_key_enc ? { baseUrl: user.own_base_url || OWN_DEFAULT_BASE_URL, model: user.own_model || OWN_DEFAULT_MODEL, last4 } : null,
  };
}

export const GET = handle(async () => {
  const { user, session } = await requireReady();
  return json(toMe(user, session));
});

const Patch = z.object({
  timezone: z.string().max(64).optional(),
  ownKey: z.union([z.null(), z.object({ baseUrl: z.url().optional(), apiKey: z.string().trim().min(8).max(500), model: z.string().trim().min(1).max(120).optional() })]).optional(),
  choice: z.enum(["publik", "own_key"]).nullable().optional(),
});

export const PATCH = handle(async (req: Request) => {
  const body = Patch.parse(await readJson(req));
  const { user, session } = await requireReady();
  if (body.timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: body.timezone }); } catch { throw new HttpError(400, "invalid_timezone", "That timezone isn't recognised."); }
    await sql`update users set timezone = ${body.timezone} where id = ${user.id}`;
  }
  if (body.ownKey === null) {
    if (session.ai_choice === "own_key") throw new HttpError(400, "own_key_in_use", "Switch to your publik plan before removing your own key.");
    await sql`update users set own_key_enc = null, own_base_url = null, own_model = null where id = ${user.id}`;
  } else if (body.ownKey) {
    const baseUrl = (body.ownKey.baseUrl ?? OWN_DEFAULT_BASE_URL).replace(/\/$/, "");
    const model = body.ownKey.model ?? OWN_DEFAULT_MODEL;
    await validateOwnKey(baseUrl, body.ownKey.apiKey, model);
    await sql`update users set own_key_enc = ${encrypt(body.ownKey.apiKey)}, own_base_url = ${baseUrl}, own_model = ${model} where id = ${user.id}`;
  }
  if (body.choice !== undefined) {
    if (body.choice === "publik") {
      const w = await freshWallet(session);
      if (!hasPlanOf(w)) throw new HttpError(402, "no_plan", "Get a publik plan first, or use your own key.", w.top_up_url);
    }
    if (body.choice === "own_key") {
      const u = (await sql`select own_key_enc from users where id = ${user.id}`)[0];
      if (!u?.own_key_enc) throw new HttpError(400, "own_key_required", "Add your API key first.");
    }
    // null: ask again (the gate shows the plan screen on the next load)
    await sql`update sessions set ai_choice = ${body.choice} where id = ${session.id}`;
  }
  const [u2] = await sql`select * from users where id = ${user.id}`;
  const [s2] = await sql`select * from sessions where id = ${session.id}`;
  return json(toMe(u2, s2));
});

/** Delete the account and everything in it: sources, tasks, actions, analytics events, sessions. */
export const DELETE = handle(async () => {
  const { user } = await requireReady();
  await sql`delete from users where id = ${user.id}`; // cascades to sources, tasks, actions, events, sessions
  await sql`delete from sessions`;
  writeCredential(null); // this computer's publik key
  await clearCookie();
  return json({ ok: true });
});
