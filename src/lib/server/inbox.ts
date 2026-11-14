import { checkDeadline, turnSignal } from "./deadline";
import type { ScanEvent } from "@/lib/types";
import { capture } from "./capture";
import { connectorRun } from "./connector";
import { sql } from "./db";
import { HttpError } from "./http";
import type { Ctx } from "./session";
import { track } from "./track";

const QUERY = "in:inbox newer_than:7d -category:promotions -category:social -category:forums";
const MAX_EMAILS = 5;
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

/** POST /api/inbox/scan: read recent inbox mail and run each new message through the capture pipeline. */
export async function* scanInbox(ctx: Ctx): AsyncGenerator<ScanEvent> {
  const signal = turnSignal.getStore() ?? AbortSignal.timeout(240_000);
  const events = scanInboxWork(ctx);
  try {
    while (true) {
      const next = await turnSignal.run(signal, () => events.next());
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await events.return(undefined);
  }
}

async function* scanInboxWork(ctx: Ctx): AsyncGenerator<ScanEvent> {
  const { user, session } = ctx;
  checkDeadline();
  const lease = (await sql`update users set scan_started_at = date_trunc('milliseconds', clock_timestamp()) where id = ${user.id}
    and (scan_started_at is null or scan_started_at < now() - interval '5 minutes') returning scan_started_at`)[0];
  if (!lease) {
    yield { type: "error", code: "scan_in_progress", message: "LooseEnds is already checking your inbox." };
    return;
  }
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
      checkDeadline();
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
    await sql`update users set scan_started_at = null where id = ${user.id} and scan_started_at = ${lease.scan_started_at}`;
  }
}
