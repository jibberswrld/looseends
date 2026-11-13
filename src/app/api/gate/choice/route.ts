import { z } from "zod";
import { OWN_DEFAULT_BASE_URL, OWN_DEFAULT_MODEL, validateOwnKey } from "@/lib/server/ai";
import { encrypt } from "@/lib/server/crypto";
import { sql } from "@/lib/server/db";
import { computeGate, freshWallet, hasPlanOf, setChoice } from "@/lib/server/gate";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

const Body = z.object({
  choice: z.enum(["publik", "own_key"]),
  ownKey: z.object({
    baseUrl: z.url().optional(),
    apiKey: z.string().trim().min(8).max(500),
    model: z.string().trim().min(1).max(120).optional(),
  }).optional(),
});

/** "Connect your plan" or "Use my own key". */
export const POST = handle(async (req: Request) => {
  const body = Body.parse(await readJson(req));
  const s = await getSession(false);
  if (!s || s.claim_state !== "claimed" || !s.user_id) throw new HttpError(401, "gate", "Sign in with publik to continue.");
  if (body.choice === "publik") {
    const w = await freshWallet(s);
    if (!hasPlanOf(w)) throw new HttpError(402, "no_plan", "Get a publik plan first, or use your own key.", w.top_up_url);
  } else {
    if (body.ownKey) {
      const baseUrl = (body.ownKey.baseUrl ?? OWN_DEFAULT_BASE_URL).replace(/\/$/, "");
      const model = body.ownKey.model ?? OWN_DEFAULT_MODEL;
      await validateOwnKey(baseUrl, body.ownKey.apiKey, model);
      await sql`update users set own_key_enc = ${encrypt(body.ownKey.apiKey)}, own_base_url = ${baseUrl}, own_model = ${model} where id = ${s.user_id}`;
    } else {
      const u = (await sql`select own_key_enc from users where id = ${s.user_id}`)[0];
      if (!u?.own_key_enc) throw new HttpError(400, "own_key_required", "Enter your API key.");
    }
  }
  await setChoice(s, body.choice);
  return json(await computeGate(s));
});
