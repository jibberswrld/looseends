// The two actions that leave the app: sending a reply with the user's Gmail and adding an event to their
// Google Calendar. Both happen only on an explicit, confirmed request, and at most once per action.
import type { ActionReceipt, EventPayload, ReplyPayload, Toolkit } from "@/lib/types";
import { connectorError, connectorRun } from "./connector";
import { sql, type Row } from "./db";
import { HttpError } from "./http";
import { advanceStatus } from "./repo";
import type { Ctx } from "./session";
import { track } from "./track";

/** The address inside "Name <a@b.co>" or a bare "a@b.co"; null for a name with no address. */
export function emailAddress(s: string | null | undefined): string | null {
  return /[^\s<>@,;:"'()]+@[^\s<>@,;:"'()]+\.[^\s<>@,;:"'()]+/.exec(s ?? "")?.[0] ?? null;
}

const noRecipient = () => new HttpError(400, "no_recipient", "Add the recipient's email address first.");

/** The Gmail thread this task's reply belongs to, when its source came from the inbox scan. */
async function gmailSource(action: Row): Promise<Row | null> {
  const rows = await sql`
    select s.thread_id, s.sender_address, s.sender from sources s join tasks t on t.source_id = s.id
    where t.id = ${action.task_id} and s.kind = 'gmail' and s.thread_id is not null`;
  return rows[0] ?? null;
}

async function replyCall(action: Row, taskTitle: string): Promise<{ tool: string; args: Record<string, unknown> }> {
  const p = action.payload as ReplyPayload;
  const src = await gmailSource(action);
  if (src) {
    const to = emailAddress(p.to) ?? emailAddress(src.sender_address) ?? emailAddress(src.sender);
    if (!to) throw noRecipient();
    // No subject: Gmail keeps the thread's own.
    return { tool: "GMAIL_REPLY_TO_THREAD", args: { thread_id: src.thread_id, recipient_email: to, message_body: p.body, is_html: false } };
  }
  const to = emailAddress(p.to);
  if (!to) throw noRecipient();
  return { tool: "GMAIL_SEND_EMAIL", args: { recipient_email: to, subject: p.subject || taskTitle, body: p.body, is_html: false } };
}

/** Wall-clock "YYYY-MM-DDTHH:MM:SS" in a timezone (Calendar reads offset-less times in `timezone`). */
function wallTime(d: Date, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function eventCall(action: Row, tz: string): { tool: string; args: Record<string, unknown> } {
  const p = action.payload as EventPayload;
  const start = new Date(p.start), end = new Date(p.end);
  const when = p.allDay
    // end_date is exclusive, so an all-day event always ends at least one day after it starts.
    ? { start_date: wallTime(start, tz).slice(0, 10), end_date: wallTime(new Date(Math.max(end.getTime(), start.getTime() + 86_400_000)), tz).slice(0, 10) }
    : { start_datetime: wallTime(start, tz), end_datetime: wallTime(end, tz) };
  return {
    tool: "GOOGLECALENDAR_CREATE_EVENT",
    args: {
      calendar_id: "primary", summary: p.title, ...when, timezone: tz,
      ...(p.location ? { location: p.location } : {}), ...(p.notes ? { description: p.notes } : {}),
      create_meeting_room: false, // the tool adds a Google Meet link unless told not to
    },
  };
}

const receipt = (what: string): string => JSON.stringify([{ what, at: new Date().toISOString() } satisfies ActionReceipt]);

/** POST /api/actions/:id/send. The caller has already checked confirm === true. */
export async function sendAction(ctx: Ctx, action: Row): Promise<void> {
  if (action.kind !== "reply" && action.kind !== "event") throw new HttpError(400, "not_sendable", "Only replies and calendar events can be sent.");
  if (action.sent_at) return; // already sent: nothing to do
  const toolkit: Toolkit = action.kind === "reply" ? "gmail" : "googlecalendar";
  const task = (await sql`select title from tasks where id = ${action.task_id}`)[0];
  const { tool, args } = action.kind === "reply" ? await replyCall(action, task?.title ?? "Reply") : eventCall(action, ctx.user.timezone || "UTC");

  // The guard: only one request may hold the action while it is being sent. An earlier failure is cleared for the retry.
  const held = await sql`update actions set sent_at = now(), status = 'prepared', error = null where id = ${action.id} and sent_at is null returning id`;
  if (!held[0]) return;

  const r = await connectorRun(tool, args);
  if (!r.ok) {
    if (r.kind === "not_connected") {
      await sql`update actions set sent_at = null where id = ${action.id}`;
      throw connectorError(r, toolkit);
    }
    const thing = action.kind === "reply" ? "reply" : "event";
    const message = r.maybeDone
      ? `We couldn't confirm that your ${thing} went through. Check ${action.kind === "reply" ? "your Gmail Sent folder" : "your Google Calendar"} before trying again.`
      : action.kind === "reply" ? "Your reply was not sent. Please try again." : "The event was not added to your calendar. Please try again.";
    await sql`update actions set sent_at = null, status = 'failed', error = ${message}, updated_at = now() where id = ${action.id}`;
    throw new HttpError(502, "send_failed", message);
  }

  const d = r.data.data ?? {};
  const externalId = action.kind === "reply" ? d.id : (d.response_data as { id?: unknown } | undefined)?.id;
  await sql`
    update actions set status = 'approved', error = null, external_id = ${typeof externalId === "string" ? externalId : null},
      receipts = receipts || ${receipt(action.kind === "reply" ? "Sent with Gmail" : "Added to Google Calendar")}::jsonb, updated_at = now()
    where id = ${action.id}`;
  await advanceStatus(action.task_id, "approved");
  await track("action_sent", { userId: ctx.user.id, sessionId: ctx.session.id, props: { kind: action.kind } });
}

/** POST /api/actions/:id/gmail-draft: put the reply in the user's Gmail drafts. Nothing is sent. */
export async function saveGmailDraft(action: Row): Promise<void> {
  if (action.kind !== "reply") throw new HttpError(400, "not_reply", "Only replies can be saved as Gmail drafts.");
  const p = action.payload as ReplyPayload;
  const src = await gmailSource(action);
  const to = emailAddress(p.to) ?? emailAddress(src?.sender_address) ?? emailAddress(src?.sender);
  const r = await connectorRun("GMAIL_CREATE_EMAIL_DRAFT", {
    body: p.body, is_html: false,
    ...(to ? { recipient_email: to } : {}),
    // In a thread, a subject would start a new one.
    ...(src ? { thread_id: src.thread_id } : p.subject ? { subject: p.subject } : {}),
  });
  if (!r.ok) {
    if (r.kind === "error") throw new HttpError(502, "draft_failed", "The draft was not saved to Gmail. Please try again.");
    throw connectorError(r, "gmail");
  }
  await sql`update actions set receipts = receipts || ${receipt("Saved to Gmail drafts")}::jsonb, updated_at = now() where id = ${action.id}`;
}
