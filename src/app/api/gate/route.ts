import { computeGate, signedOutGate } from "@/lib/server/gate";
import { handle, json } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

/**
 * GET: the gate for this browser. A visitor without a session gets the sign-in screen and nothing is created, so
 * page loads, bots and crawlers never make a session row or a publik install. The client polls this while waiting.
 */
export const GET = handle(async () => {
  const s = await getSession(false);
  return json(s ? await computeGate(s) : signedOutGate());
});

/** POST: "Sign in with publik" was clicked. Creates the session and its publik install, and returns the claim URL. */
export const POST = handle(async () => {
  const s = (await getSession(true))!;
  return json(await computeGate(s));
});
