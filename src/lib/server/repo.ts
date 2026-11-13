import type { Action, Source, SourceSummary, Task } from "@/lib/types";
import { sql, type Row } from "./db";
import { HttpError } from "./http";

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export function toSourceSummary(r: Row): SourceSummary {
  return { id: r.id, kind: r.kind, title: r.title, createdAt: iso(r.created_at)!, injectionDetected: !!r.injection_detected };
}

export function toSource(r: Row): Source {
  return { ...toSourceSummary(r), content: r.content, classification: r.classification, summary: r.summary ?? null };
}

export function toAction(r: Row): Action {
  const base = {
    id: r.id, taskId: r.task_id, status: r.status, receipts: r.receipts ?? [], error: r.error ?? null,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  };
  if (r.kind === "reminder") {
    return { ...base, kind: "reminder", payload: { remindAt: iso(r.remind_at)!, note: r.payload?.note ?? null, firedAt: iso(r.fired_at) } };
  }
  return { ...base, kind: r.kind, payload: r.payload } as Action;
}

export function toTask(r: Row, source: Row | null, actions: Row[]): Task {
  return {
    id: r.id,
    sourceId: r.source_id ?? null,
    title: r.title,
    nextStepType: r.next_step_type,
    nextStep: r.next_step,
    evidence: r.evidence_quote ? { quote: r.evidence_quote, start: r.evidence_start ?? null, end: r.evidence_end ?? null } : null,
    dueAt: iso(r.due_at),
    dueAllDay: !!r.due_all_day,
    dueStatus: r.due_status,
    dueText: r.due_text ?? null,
    dueNote: r.due_note ?? null,
    priority: r.priority,
    confidence: Number(r.confidence),
    status: r.status,
    snoozedUntil: iso(r.snoozed_until),
    recipient: r.recipient ?? null,
    duplicateOf: r.duplicate_of ?? null,
    isPromotional: !!r.is_promotional,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    completedAt: iso(r.completed_at),
    source: source ? toSourceSummary(source) : null,
    actions: actions.map(toAction),
  };
}

/** Hydrate task rows with their source summary and actions. Keeps the input order. */
export async function hydrate(rows: Row[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sourceIds = [...new Set(rows.map((r) => r.source_id).filter(Boolean))];
  const [actions, sources] = await Promise.all([
    sql`select * from actions where task_id = any(${ids}::uuid[]) order by created_at`,
    sourceIds.length ? sql`select id, kind, title, created_at, injection_detected from sources where id = any(${sourceIds}::uuid[])` : Promise.resolve([] as Row[]),
  ]);
  const byTask = new Map<string, Row[]>();
  for (const a of actions) byTask.set(a.task_id, [...(byTask.get(a.task_id) ?? []), a]);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  return rows.map((r) => toTask(r, r.source_id ? srcById.get(r.source_id) ?? null : null, byTask.get(r.id) ?? []));
}

export async function loadTaskRow(userId: string, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found", "That task no longer exists.");
  const rows = await sql`select * from tasks where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) throw new HttpError(404, "not_found", "That task no longer exists.");
  return rows[0];
}

export async function loadTask(userId: string, id: string): Promise<Task> {
  return (await hydrate([await loadTaskRow(userId, id)]))[0];
}

export async function loadActionRow(userId: string, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found", "That action no longer exists.");
  const rows = await sql`select * from actions where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) throw new HttpError(404, "not_found", "That action no longer exists.");
  return rows[0];
}

export async function loadSourceRow(userId: string, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found", "That source no longer exists.");
  const rows = await sql`select * from sources where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) throw new HttpError(404, "not_found", "That source no longer exists.");
  return rows[0];
}

/** Moves a task forward in the action lifecycle without ever moving it backwards. */
const ORDER = ["detected", "reviewed", "prepared", "approved"];
export async function advanceStatus(taskId: string, to: "reviewed" | "prepared" | "approved") {
  const allowedFrom = ORDER.slice(0, ORDER.indexOf(to));
  await sql`update tasks set status = ${to}, updated_at = now() where id = ${taskId} and status = any(${allowedFrom}::text[])`;
}
