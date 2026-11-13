import { createHash } from "node:crypto";
import type { CaptureResult, SourceKind, Task } from "@/lib/types";
import { AiRequestError, resolveProvider } from "./ai";
import { sql, type Row } from "./db";
import {
  buildMessages, contentHash, decideDue, locateEvidence, runExtraction, sameEvidence, similarTitle, type Extraction,
} from "./extract";
import { HttpError } from "./http";
import { hydrate, toSource, toSourceSummary } from "./repo";
import type { Ctx } from "./session";
import { track } from "./track";

const TEXT_LIMIT = 30_000;
const PDF_LIMIT = 60_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 3_500_000; // keeps the base64 request under publik's 4 MB limit

export interface CaptureInput {
  kind: SourceKind;
  text?: string;
  image?: { bytes: Buffer; mime: string };
  fileName: string | null;
  title: string | null;
  force: boolean;
  /** Set by the inbox scan (kind "gmail"): where the email came from, so it is imported once and replies stay in its thread. */
  gmail?: { from: string; address: string | null; externalId: string; threadId: string | null };
}

/** Parse the request body: JSON {text, title?, force?} or multipart with `file` (image or PDF). */
export async function readCaptureInput(req: Request): Promise<CaptureInput> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const force = form?.get("force") === "true";
    if (!(file instanceof File)) throw new HttpError(400, "no_file", "Choose a file to upload.");
    const mime = (file.type || "").toLowerCase();
    const name = file.name || null;
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) throw new HttpError(400, "empty_file", "That file is empty.");
    if (mime === "application/pdf" || name?.toLowerCase().endsWith(".pdf")) {
      if (bytes.length > 15_000_000) throw new HttpError(413, "too_large", "That PDF is too large. Try one under 15 MB.");
      const { extractText } = await import("unpdf");
      let text = "";
      try {
        text = (await extractText(new Uint8Array(bytes), { mergePages: true })).text;
      } catch {
        throw new HttpError(422, "pdf_unreadable", "We couldn't open that PDF. It may be damaged or password-protected.");
      }
      text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) throw new HttpError(422, "pdf_no_text", "This PDF has no selectable text (it may be a scan). Try a screenshot instead.");
      return { kind: "pdf", text: text.slice(0, PDF_LIMIT), fileName: name, title: null, force };
    }
    if (/heic|heif/.test(mime) || /\.(heic|heif)$/i.test(name ?? "")) {
      throw new HttpError(415, "unsupported_type", "HEIC photos aren't supported yet. Take a screenshot or export it as JPG.");
    }
    if (!IMAGE_TYPES.includes(mime)) throw new HttpError(415, "unsupported_type", "LooseEnds can read PNG, JPG, WebP, GIF and PDF files.");
    if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "too_large", "That image is too large. Try a smaller screenshot.");
    return { kind: "image", image: { bytes, mime }, fileName: name, title: null, force };
  }
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; title?: unknown; force?: unknown };
  const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n").trim() : "";
  if (!text) throw new HttpError(400, "empty", "Paste a message first.");
  if (text.length > TEXT_LIMIT) throw new HttpError(413, "too_large", "That's longer than LooseEnds can read at once (30,000 characters). Paste the important part.");
  return { kind: "text", text, fileName: null, title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : null, force: body.force === true };
}

export async function capture(ctx: Ctx, input: CaptureInput): Promise<CaptureResult> {
  const { user, session } = ctx;
  const tz: string = user.timezone || "UTC";
  const hash = input.image ? `img:${createHash("sha256").update(input.image.bytes).digest("hex")}` : contentHash(input.text!);

  if (!input.force) {
    const dup = (await sql`select id, kind, title, created_at, injection_detected, sender from sources where user_id = ${user.id} and content_hash = ${hash} order by created_at desc limit 1`)[0];
    if (dup) {
      return { outcome: "duplicate_source", source: null, tasks: [], duplicateOf: toSourceSummary(dup), message: "You already added this. Its tasks are in your queue, or you can add it again anyway." };
    }
  }

  const provider = resolveProvider(session, user);
  const now = new Date();
  const messages = buildMessages(
    input.image ? { imageDataUrl: `data:${input.image.mime};base64,${input.image.bytes.toString("base64")}`, fileName: input.fileName } : { text: input.text, fileName: input.fileName },
    now, tz,
  );
  let ex: Extraction;
  try {
    ex = await runExtraction(provider, messages);
  } catch (e) {
    if (input.image && e instanceof AiRequestError && e.code === "ai_error") {
      throw new HttpError(422, "image_unsupported", "This AI plan can't read images yet. Paste the text instead.");
    }
    throw e;
  }
  await track("input_captured", { userId: user.id, sessionId: session.id, props: { kind: input.kind } });

  const content = input.image ? (ex.transcript ?? "").trim() : input.text!;
  if (input.image && !content && ex.tasks.length === 0) {
    return { outcome: "no_action", source: null, tasks: [], duplicateOf: null, message: "We couldn't read any text in this image. Try a sharper screenshot, or paste the text instead." };
  }

  const title = input.title || ex.title || input.fileName || (input.kind === "image" ? "Screenshot" : input.kind === "pdf" ? "PDF document" : "Pasted message");
  const realTasks = ex.tasks.filter((t) => !t.is_promotional);
  const classification = realTasks.length > 0 ? "obligations"
    : ex.classification === "promotional" || ex.tasks.length > 0 ? "promotional" : "no_action";

  const src = (await sql`
    insert into sources (user_id, kind, title, content, content_hash, classification, summary, injection_detected, external_id, thread_id, sender, sender_address)
    values (${user.id}, ${input.kind}, ${title}, ${content}, ${hash}, ${classification}, ${ex.summary}, ${ex.injection_detected},
      ${input.gmail?.externalId ?? null}, ${input.gmail?.threadId ?? null}, ${input.gmail?.from ?? null}, ${input.gmail?.address ?? null})
    returning *`)[0];

  const open = await sql`select id, title, evidence_quote from tasks where user_id = ${user.id} and status not in ('completed', 'dismissed') and (source_id is null or source_id <> ${src.id})`;
  const inserted: Row[] = [];
  for (const t of realTasks) {
    const loc = t.evidence_quote ? locateEvidence(content, t.evidence_quote) : null;
    const quote = loc ? content.slice(loc.start, loc.end) : t.evidence_quote || null;
    const due = decideDue(t, content, tz);
    const dup = open.find((o) => similarTitle(o.title, t.title) || sameEvidence(o.evidence_quote, quote));
    const confidence = loc ? t.confidence : Math.min(t.confidence, 0.4);
    const row = (await sql`
      insert into tasks (user_id, source_id, title, next_step_type, next_step, evidence_quote, evidence_start, evidence_end,
        due_at, due_all_day, due_status, due_text, due_note, priority, confidence, status, recipient, duplicate_of, is_promotional)
      values (${user.id}, ${src.id}, ${t.title}, ${t.next_step_type}, ${t.next_step}, ${quote}, ${loc?.start ?? null}, ${loc?.end ?? null},
        ${due.dueAt?.toISOString() ?? null}, ${due.dueAllDay}, ${due.dueStatus}, ${due.dueText}, ${due.dueNote}, ${t.priority}, ${confidence},
        'detected', ${t.recipient}, ${dup?.id ?? null}, ${t.is_promotional})
      returning *`)[0];
    inserted.push(row);
  }
  await track("tasks_detected", { userId: user.id, sessionId: session.id, props: { count: realTasks.length, classification } });

  const tasks: Task[] = await hydrate(inserted);
  const outcome = classification === "promotional" ? "promotional" : realTasks.length > 0 ? "tasks" : "no_action";
  const message = outcome === "promotional"
    ? "This looks like marketing or a newsletter, not something you have to do."
    : outcome === "no_action" ? "We didn't find anything you need to do in this. You can add a task yourself." : null;
  return { outcome, source: toSource(src), tasks, duplicateOf: null, message };
}
