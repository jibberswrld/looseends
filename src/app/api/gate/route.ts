import { computeGate } from "@/lib/server/gate";
import { handle, json } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

/** The Sign in with publik gate. The client polls this every 3 s (max 10 min) while the sign-in screen is up. */
export const GET = handle(async () => {
  const s = (await getSession(true))!;
  return json(await computeGate(s));
});
