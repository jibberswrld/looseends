import { sql } from "./db";
import { HttpError } from "./http";

const LIMITS = { agent: 60, capture: 60, scan: 20, ask: 60 } as const;

/** One row per user/operation; the database atomically starts and counts each UTC hour. */
export async function rateLimit(userId: string, bucket: keyof typeof LIMITS) {
  const limit = LIMITS[bucket];
  const rows = await sql`
    insert into rate_limits (user_id, bucket, window_start, count)
    values (${userId}, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (user_id, bucket) do update set
      window_start = excluded.window_start,
      count = case when rate_limits.window_start < excluded.window_start then 1 else rate_limits.count + 1 end
    where rate_limits.window_start < excluded.window_start or rate_limits.count < ${limit}
    returning count`;
  if (!rows[0]) throw new HttpError(429, "rate_limited", `You've reached the ${bucket === "scan" ? "inbox scan" : bucket} limit of ${limit} per hour. Please try again next hour.`);
}
