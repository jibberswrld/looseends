import { z } from "zod";
import { sql } from "@/lib/server/db";
import { handle, json, readJson } from "@/lib/server/http";
import { hydrate } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";

export const GET = handle(async (req: Request) => {
  const { user } = await requireReady();
  const view = new URL(req.url).searchParams.get("view") === "history" ? "history" : "open";
  const rows = view === "open"
    ? await sql`
        select * from tasks where user_id = ${user.id} and status not in ('completed', 'dismissed')
        order by due_at asc nulls last,
          case priority when 'high' then 0 when 'normal' then 1 else 2 end,
          created_at desc
        limit 500`
    : await sql`
        select * from tasks where user_id = ${user.id} and status in ('completed', 'dismissed', 'approved')
        order by updated_at desc limit 200`;
  return json({ tasks: await hydrate(rows) });
});

const Create = z.object({
  title: z.string().trim().min(1).max(120),
  nextStep: z.string().trim().max(300).optional(),
  nextStepType: z.enum(["reply", "event", "reminder", "form", "call", "pay", "other"]).optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  dueAllDay: z.boolean().optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
});

/** Add a task by hand (the "no action found" fallback, or anything the user remembers). */
export const POST = handle(async (req: Request) => {
  const body = Create.parse(await readJson(req));
  const { user } = await requireReady();
  const [row] = await sql`
    insert into tasks (user_id, title, next_step_type, next_step, due_at, due_all_day, due_status, priority, confidence, status)
    values (${user.id}, ${body.title}, ${body.nextStepType ?? "other"}, ${body.nextStep ?? ""}, ${body.dueAt ?? null}, ${body.dueAllDay ?? false},
      ${body.dueAt ? "confirmed" : "none"}, ${body.priority ?? "normal"}, 1, 'reviewed')
    returning *`;
  return json((await hydrate([row]))[0], 201);
});
