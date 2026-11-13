// Shared contract between the API routes (src/app/api/**) and the UI.
// Dates are ISO 8601 strings in JSON.

export type TaskStatus =
  | "detected" // extracted by AI, not yet looked at
  | "reviewed" // user confirmed / edited it
  | "prepared" // a next step (draft, event, reminder) has been prepared
  | "approved" // user approved / exported the prepared step (copied, opened in mail, downloaded .ics)
  | "completed"
  | "failed"
  | "dismissed";

export type DueStatus =
  | "confirmed" // explicit in the source, or set/confirmed by the user
  | "needs_review" // a date was inferred (e.g. "Thursday") and must be confirmed by the user
  | "unclear" // the source references a deadline but it can't be pinned ("before your visit")
  | "none"; // no date found

export type NextStepType = "reply" | "event" | "reminder" | "form" | "call" | "pay" | "other";
export type Priority = "high" | "normal" | "low";

export interface Evidence {
  quote: string; // verbatim excerpt from the source
  start: number | null; // char offsets into Source.content, null if not located
  end: number | null;
}

export interface Task {
  id: string;
  sourceId: string | null;
  title: string; // verb + object: "Confirm appointment"
  nextStepType: NextStepType;
  nextStep: string; // plain-language proposed next step
  evidence: Evidence | null;
  dueAt: string | null;
  dueAllDay: boolean;
  dueStatus: DueStatus;
  dueText: string | null; // the raw phrase from the source, e.g. "Thursday by 3 p.m."
  dueNote: string | null; // why it needs review / is unclear
  priority: Priority;
  confidence: number; // 0..1
  status: TaskStatus;
  snoozedUntil: string | null;
  recipient: string | null; // who a reply would go to, if known
  duplicateOf: string | null; // suggested merge target (another open task id)
  isPromotional: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  source: SourceSummary | null;
  actions: Action[];
}

export type SourceKind = "text" | "image" | "pdf" | "manual" | "gmail";
export type SourceClassification = "obligations" | "no_action" | "promotional";

export interface SourceSummary {
  id: string;
  kind: SourceKind;
  title: string; // "Email from Dr. Patel's office", file name, etc.
  createdAt: string;
  injectionDetected: boolean; // the content contained instructions aimed at an AI; they were ignored
  from: string | null; // sender display name/address for gmail sources, else null
}

export interface Source extends SourceSummary {
  content: string; // normalized text (for images: transcription; for PDFs: extracted text)
  classification: SourceClassification;
  summary: string | null;
}

export type ActionKind = "reply" | "event" | "reminder";
export type ActionStatus = "prepared" | "approved" | "failed";

export interface ReplyPayload {
  to: string | null;
  subject: string | null;
  body: string;
}
export interface EventPayload {
  title: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  location: string | null;
  notes: string | null;
}
export interface ReminderPayload {
  remindAt: string; // ISO
  note: string | null;
}

export interface ActionReceipt {
  what: string; // "Copied to clipboard", "Opened in your mail app", "Downloaded calendar file"
  at: string; // ISO
}

export type Action =
  | ActionBase<"reply", ReplyPayload>
  | ActionBase<"event", EventPayload>
  | ActionBase<"reminder", ReminderPayload & { firedAt: string | null }>;

interface ActionBase<K extends ActionKind, P> {
  id: string;
  taskId: string;
  kind: K;
  payload: P;
  status: ActionStatus;
  receipts: ActionReceipt[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Sign in with publik gate ----
export type GateState =
  | "not_configured" // server has no PUBLIK_APP_TOKEN
  | "unreachable" // publik did not answer
  | "sign_in" // install exists, not claimed yet
  | "choose" // claimed, USES_AI and no stored choice
  | "ready";

export interface GateInfo {
  state: GateState;
  title: string;
  body: string;
  note: string | null;
  claimUrl: string | null;
  topUpUrl: string | null;
  handle: string | null;
  plan: { kind: "none" | "plan" | "pack"; label: string | null } | null;
  balanceMicros: number | null;
  choice: "publik" | "own_key" | null;
  hasPlan: boolean; // plan.kind !== "none" || balance > 0  -> "Connect your plan" else "Get a plan"
}

export interface Me {
  handle: string | null;
  timezone: string | null;
  choice: "publik" | "own_key" | null;
  ownKey: { baseUrl: string; model: string; last4: string } | null;
}

// ---- API payloads ----
export type CaptureOutcome = "tasks" | "no_action" | "promotional" | "duplicate_source";

export interface CaptureResult {
  outcome: CaptureOutcome;
  source: Source | null;
  tasks: Task[];
  duplicateOf: SourceSummary | null; // when outcome === "duplicate_source"
  message: string | null; // human explanation for no_action / promotional / duplicate
}

// Every API error is { error: { code, message, topUpUrl? } } with a non-2xx status.
export interface ApiError {
  error: { code: string; message: string; topUpUrl?: string | null };
}

// ---- Connected apps (through Composio, via the hosted LooseEnds connector service) ----
/** A Composio toolkit slug: "gmail", "googlecalendar", "slack", "notion", ... */
export type Toolkit = string;
export interface ConnectorApp {
  slug: Toolkit;
  name: string; // "Gmail", "Google Calendar", "Slack"
  logo: string | null; // image URL from Composio toolkit metadata
  connected: boolean;
}
export interface Connections {
  available: boolean; // false when the connector service is not configured or unreachable
  message: string | null; // why it is unavailable, in plain words
  apps: ConnectorApp[]; // every app LooseEnds supports, in display order (gmail, googlecalendar first)
  gmail: { connected: boolean; lastScanAt: string | null };
  googlecalendar: { connected: boolean };
}
// GET  /api/connections                      -> Connections
// POST /api/connections/link {toolkit}       -> { url }   (open in a new tab; then poll GET /api/connections)
// POST /api/connections/disconnect {toolkit} -> Connections

// ---- The agent: one conversation per user, about their inbox, tasks and connected apps ----
// Reads (search mail, list events, look up a Notion page...) run straight away.
// Anything that changes something outside LooseEnds (send an email, post to Slack, create an event...) becomes an
// AgentAction with status "pending" and runs only after the user approves it.
export type AgentActionStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export interface AgentAction {
  id: string;
  app: Toolkit; // "gmail"
  tool: string; // Composio tool slug, "GMAIL_SEND_EMAIL"
  title: string; // short imperative label: "Send email to Dr. Patel"
  summary: string; // what will happen, in plain words, incl. the key content (recipient, subject, body / message text)
  args: Record<string, unknown>; // the exact arguments that will run; the UI may let the user edit text fields
  status: AgentActionStatus;
  result: string | null; // plain-language outcome after it ran ("Sent", "Event created for Fri 3 PM")
  error: string | null;
}
export interface AgentToolStep {
  id: string;
  label: string; // "Searching Gmail for 'invoice'", "Reading 3 emails", "Looking up your calendar"
  status: "running" | "done" | "failed";
}
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string; // markdown-lite: paragraphs, "- " bullets, **bold**; no headings or tables
  steps: AgentToolStep[]; // what the agent did while answering (assistant only)
  actions: AgentAction[]; // actions it proposed (assistant only)
  taskIds: string[]; // tasks it created or referred to (assistant only)
  createdAt: string;
}
// GET    /api/agent                       -> { messages: AgentMessage[] }   (oldest first, last 100)
// DELETE /api/agent                       -> { messages: [] }               (start over)
// POST   /api/agent {message}             -> NDJSON stream of AgentEvent (content-type application/x-ndjson)
// POST   /api/agent/actions/:id {decision: "approve" | "cancel", args?}  -> NDJSON stream of AgentEvent
//   approve: runs the action (with edited args if given), then the agent writes a one-line follow-up.
//   cancel: marks it cancelled; no follow-up model call.
export type AgentEvent =
  | { type: "message"; message: AgentMessage } // the user message as stored, or an assistant message as created
  | { type: "text"; messageId: string; delta: string } // streamed assistant text
  | { type: "step"; messageId: string; step: AgentToolStep } // a tool step started or finished (same id = update)
  | { type: "action"; messageId: string; action: AgentAction } // a proposed action, or an action's new status
  | { type: "tasks"; tasks: Task[] } // tasks the agent created or changed; the UI merges them into its list
  | { type: "connections"; connections: Connections } // the agent connected/linked something; refresh the sidebar
  | { type: "done"; messageId: string }
  | { type: "error"; code: string; message: string; topUpUrl?: string | null };

// POST /api/inbox/scan  -> NDJSON stream (content-type application/x-ndjson), one ScanEvent per line.
export type ScanEvent =
  | { type: "step"; text: string } // "Opening your inbox", "Reading 12 unread emails"
  | { type: "email"; from: string; subject: string; outcome: "tasks" | "promotional" | "no_action" | "duplicate"; tasks: Task[] }
  | { type: "done"; scanned: number; found: number; skipped: number }
  | { type: "error"; code: string; message: string; topUpUrl?: string | null };

// POST /api/actions/:id/send {confirm: true} -> { task }
//   reply action: sends the reply with the user's Gmail (in the original thread when the source is a gmail message).
//   event action: creates the event in the user's Google Calendar.
//   Requires the matching connection and confirm === true. Idempotent: an action already sent returns the task unchanged.
//   Appends a receipt ("Sent with Gmail" / "Added to Google Calendar"); on failure sets action.status "failed" + error.
// POST /api/actions/:id/gmail-draft -> { task }  saves the reply as a draft in Gmail; receipt "Saved to Gmail drafts".

// POST /api/ask {question} -> AskAnswer   answers a question about the user's own queue ("what's due this week?")
export interface AskAnswer {
  answer: string; // short plain text
  taskIds: string[]; // tasks the answer refers to, in order
}
