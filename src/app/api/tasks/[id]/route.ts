import { z } from "zod";
import { query, sql } from "@/lib/server/db";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { loadTask, loadTaskRow } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";
import { track } from "@/lib/server/track";

const Patch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  nextStep: z.string().trim().max(300).optional(),
  nextStepType: z.enum(["reply", "event", "reminder", "form", "call", "pay", "other"]).optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  dueAllDay: z.boolean().optional(),
  dueStatus: z.enum(["confirmed", "needs_review", "unclear", "none"]).optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  status: z.enum(["detected", "reviewed", "prepared", "approved", "completed", "failed", "dismissed"]).optional(),
  snoozedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  recipient: z.string().trim().max(200).nullable().optional(),
  duplicateOf: z.null().optional(),
});

const COLUMNS: Record<string, string> = {
  title: "title", nextStep: "next_step", nextStepType: "next_step_type", dueAt: "due_at", dueAllDay: "due_all_day",
  dueStatus: "due_status", priority: "priority", status: "status", snoozedUntil: "snoozed_until", recipient: "recipient", duplicateOf: "duplicate_of",
};

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/tasks/[id]">) => {
  const body = Patch.parse(await readJson(req));
  const { user, session } = await requireReady();
  const { id } = await ctx.params;
  const row = await loadTaskRow(user.id, id);

  const set: Record<string, unknown> = { ...body };
  // Editing or confirming a date makes it the user's date.
  if (body.dueAt !== undefined && body.dueStatus === undefined) set.dueStatus = body.dueAt ? "confirmed" : "none";
  if (body.dueAt === null && body.dueAllDay === undefined) set.dueAllDay = false;
  const edited = Object.keys(body).filter((k) => !["status", "snoozedUntil", "duplicateOf"].includes(k));
  // Any edit, or confirming a detected task, moves it to "reviewed".
  if (row.status === "detected" && body.status === undefined && Object.keys(body).length > 0) set.status = "reviewed";

  const keys = Object.keys(set).filter((k) => set[k] !== undefined);
  if (keys.length === 0) throw new HttpError(400, "nothing_to_update", "Nothing to change.");
  const assigns = keys.map((k, i) => `${COLUMNS[k]} = $${i + 1}`);
  const params = keys.map((k) => set[k]);
  let extra = ", updated_at = now()";
  if (set.status === "completed") extra += ", completed_at = now()";
  else if (set.status && set.status !== "completed") extra += ", completed_at = null";
  params.push(id, user.id);
  await query(`update tasks set ${assigns.join(", ")}${extra} where id = $${params.length - 1} and user_id = $${params.length}`, params);

  const t = { userId: user.id, sessionId: session.id };
  if (row.status === "detected" && set.status === "reviewed") await track("task_confirmed", t);
  if (set.status === "completed" && row.status !== "completed") await track("task_completed", t);
  if (set.status === "dismissed" && row.status !== "dismissed") await track("task_dismissed", t);
  if (edited.length) await track("task_edited", { ...t, props: { fields: edited } });
  return json(await loadTask(user.id, id));
});

export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/tasks/[id]">) => {
  const { user } = await requireReady();
  const { id } = await ctx.params;
  await loadTaskRow(user.id, id);
  await sql`delete from tasks where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
