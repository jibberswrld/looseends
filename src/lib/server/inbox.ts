import type { ScanEvent } from "@/lib/types";
import { capture } from "./capture";
import { connectorRun } from "./connector";
import { sql } from "./db";
import { HttpError } from "./http";
import type { Ctx } from "./session";
import { track } from "./track";

const QUERY = "in:inbox newer_than:7d -category:promotions -category:social -category:forums";
const MAX_EMAILS = 15;
const BODY_LIMIT = 8_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Email bodies often arrive as HTML. Evidence quotes need plain text. */
function plainText(s: string): string {
  let t = s.replace(/\r\n/g, "\n");
  if (/<(html|body|div|p|br|table|span|a)\b/i.test(t)) {
    t = t
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#39|[a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
  }
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** One scan at a time per person: a second click must not pay for the same emails twice. */
const running = new Set<string>();

/** POST /api/inbox/scan: read recent inbox mail and run each new message through the capture pipeline. */
export async function* scanInbox(ctx: Ctx): AsyncGenerator<ScanEvent> {
  const { user, session } = ctx;
  if (running.has(user.id)) {
    yield { type: "error", code: "scan_in_progress", message: "LooseEnds is already checking your inbox." };
    return;
  }
  running.add(user.id);
  try {
    yield { type: "step", text: "Opening your inbox" };
    const r = await connectorRun("GMAIL_FETCH_EMAILS", { query: QUERY, max_results: MAX_EMAILS, include_payload: true, verbose: true });
    if (!r.ok) {
      yield { type: "error", code: r.kind === "error" ? r.code : r.kind, message: r.kind === "not_connected" ? "Connect Gmail first." : r.message };
      return;
    }
    const raw = Array.isArray(r.data.data?.messages) ? (r.data.data.messages as Record<string, unknown>[]) : [];
    const emails = raw.filter((m) => str(m.messageId)).slice(0, MAX_EMAILS);
    yield { type: "step", text: emails.length === 0 ? "No new emails from the last 7 days" : `Reading ${emails.length} ${emails.length === 1 ? "email" : "emails"}` };

    const tz: string = user.timezone || "UTC";
    let scanned = 0, found = 0, skipped = 0;
    for (const m of emails) {
      const id = str(m.messageId);
      const rawSender = str(m.sender) || "Unknown sender";
      const from = rawSender.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "").trim() || rawSender;
      const address = /<([^<>\s]+@[^<>\s]+)>/.exec(rawSender)?.[1] ?? (/^[^\s<>]+@[^\s<>]+$/.test(rawSender) ? rawSender : null);
      const subject = str(m.subject) || "(no subject)";
      const seen = await sql`select 1 from sources where user_id = ${user.id} and external_id = ${id} limit 1`;
      if (seen[0]) {
        skipped++;
        yield { type: "email", from, subject, outcome: "duplicate", tasks: [] };
        continue;
      }
      const sent = new Date(str(m.messageTimestamp));
      const date = Number.isNaN(sent.getTime()) ? null : new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(sent);
      const preview = m.preview && typeof m.preview === "object" ? str((m.preview as { body?: unknown }).body) : "";
      const body = (plainText(str(m.messageText)) || preview).slice(0, BODY_LIMIT);
      const text = `From: ${from}\nSubject: ${subject}\n${date ? `Date: ${date}\n` : ""}\n${body}`;
      try {
        const result = await capture(ctx, {
          kind: "gmail", text, fileName: null, title: from.slice(0, 80), force: false,
          gmail: { from, address, externalId: id, threadId: str(m.threadId) || null },
        });
        if (result.outcome === "duplicate_source") {
          skipped++;
          yield { type: "email", from, subject, outcome: "duplicate", tasks: [] };
          continue;
        }
        scanned++;
        if (result.outcome === "tasks") found += result.tasks.filter((t) => !t.isPromotional).length;
        yield { type: "email", from, subject, outcome: result.outcome, tasks: result.tasks };
      } catch (e) {
        // Out of balance, signed out, AI down: stop here. Emails already read stay imported; the rest wait for the next scan.
        if (!(e instanceof HttpError)) console.error("[scan]", e);
        yield e instanceof HttpError
          ? { type: "error", code: e.code, message: e.message, ...(e.topUpUrl ? { topUpUrl: e.topUpUrl } : {}) }
          : { type: "error", code: "server_error", message: "Something went wrong while reading your inbox. Please try again." };
        return;
      }
    }
    await sql`update users set gmail_last_scan_at = now() where id = ${user.id}`;
    await track("inbox_scanned", { userId: user.id, sessionId: session.id, props: { scanned, found } });
    yield { type: "done", scanned, found, skipped };
  } finally {
    running.delete(user.id);
  }
}
