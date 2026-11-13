import { sql } from "./db";

/** Product analytics (spec section 07). Names and counts only, never content. Never throws. */
export async function track(name: string, opts: { userId?: string | null; sessionId?: string | null; props?: Record<string, unknown> } = {}) {
  try {
    await sql`insert into events (user_id, session_id, name, props) values (${opts.userId ?? null}, ${opts.sessionId ?? null}, ${name}, ${JSON.stringify(opts.props ?? {})}::jsonb)`;
  } catch (e) {
    console.error("[track]", name, e);
  }
}
