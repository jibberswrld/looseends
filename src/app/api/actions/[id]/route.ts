import { z } from "zod";
import type { ActionReceipt } from "@/lib/types";
import { sql } from "@/lib/server/db";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { advanceStatus, loadActionRow, loadTask } from "@/lib/server/repo";
import { requireReady } from "@/lib/server/session";
import { track } from "@/lib/server/track";

const Patch = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["prepared", "approved", "failed"]).optional(),
  receipt: z.object({ what: z.string().trim().min(1).max(120) }).optional(),
  error: z.string().trim().max(300).nullable().optional(),
});

const ReplyPayload = z.object({ to: z.string().max(200).nullable(), subject: z.string().max(200).nullable(), body: z.string().min(1).max(5000) });
const EventPayload = z.object({
  title: z.string().min(1).max(200), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
  allDay: z.boolean(), location: z.string().max(300).nullable(), notes: z.string().max(2000).nullable(),
});
const ReminderPayload = z.object({ remindAt: z.iso.datetime({ offset: true }), note: z.string().max(500).nullable() });

/** Edit a prepared action, approve it, or record a receipt ("Copied to clipboard", "Downloaded calendar file"). */
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/actions/[id]">) => {
  const body = Patch.parse(await readJson(req));
  const { user, session } = await requireReady();
  const { id } = await ctx.params;
  const a = await loadActionRow(user.id, id);

  if (body.payload) {
    if (a.kind === "reply") {
      const p = ReplyPayload.parse({ to: null, subject: null, ...a.payload, ...body.payload });
      await sql`update actions set payload = ${JSON.stringify(p)}::jsonb, updated_at = now() where id = ${id}`;
    } else if (a.kind === "event") {
      const p = EventPayload.parse({ ...a.payload, ...body.payload });
      if (new Date(p.end) <= new Date(p.start)) throw new HttpError(400, "bad_range", "The event has to end after it starts.");
      await sql`update actions set payload = ${JSON.stringify(p)}::jsonb, updated_at = now() where id = ${id}`;
    } else {
      const p = ReminderPayload.parse({ remindAt: new Date(a.remind_at).toISOString(), note: a.payload?.note ?? null, ...body.payload });
      await sql`update actions set payload = ${JSON.stringify({ note: p.note })}::jsonb, remind_at = ${p.remindAt}, fired_at = null, updated_at = now() where id = ${id}`;
    }
  }
  if (body.receipt) {
    const receipts = (a.receipts ?? []) as ActionReceipt[];
    const last = receipts.at(-1);
    const isRepeat = last && last.what === body.receipt.what && Date.now() - new Date(last.at).getTime() < 5_000;
    if (!isRepeat) {
      const r: ActionReceipt = { what: body.receipt.what, at: new Date().toISOString() };
      await sql`update actions set receipts = receipts || ${JSON.stringify([r])}::jsonb, updated_at = now() where id = ${id}`;
    }
  }
  const status = body.status ?? (body.receipt && a.status === "prepared" ? "approved" : undefined);
  if (status) {
    await sql`update actions set status = ${status}, error = ${status === "failed" ? body.error ?? "Something went wrong." : null}, updated_at = now() where id = ${id}`;
    if (status === "approved" && a.status !== "approved") {
      await advanceStatus(a.task_id, "approved");
      await track("action_approved", { userId: user.id, sessionId: session.id, props: { kind: a.kind, what: body.receipt?.what ?? null } });
    }
  }
  return json({ task: await loadTask(user.id, a.task_id) });
});

export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/actions/[id]">) => {
  const { user } = await requireReady();
  const { id } = await ctx.params;
  const a = await loadActionRow(user.id, id);
  await sql`delete from actions where id = ${id} and user_id = ${user.id}`;
  return json({ task: await loadTask(user.id, a.task_id) });
});
