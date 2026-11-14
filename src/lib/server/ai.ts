import { checkDeadline, requestSignal } from "./deadline";
import { providerFetch } from "./provider-fetch";
import { decrypt } from "./crypto";
import type { Row } from "./db";
import { HttpError } from "./http";
import { DEFAULT_BASE_URL, MODELS, topUpUrlFrom402 } from "./publik";
import { sessionKey } from "./session";

export const OWN_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OWN_DEFAULT_MODEL = "gpt-4o-mini";
const MAX_BYTES = 4 * 1024 * 1024;

export interface Provider {
  kind: "publik" | "own";
  baseURL: string;
  apiKey: string;
  model: string;
}

/** Which key pays for this request: the publik install key after "Connect your plan", or the user's own key. */
export function resolveProvider(session: Row, user: Row): Provider {
  if (session.ai_choice === "publik") {
    const key = sessionKey(session);
    if (!key) throw new HttpError(401, "gate", "Sign in with publik to continue.");
    return { kind: "publik", baseURL: session.publik_base_url || DEFAULT_BASE_URL, apiKey: key, model: MODELS.balanced };
  }
  if (session.ai_choice === "own_key" && user.own_key_enc) {
    return { kind: "own", baseURL: user.own_base_url || OWN_DEFAULT_BASE_URL, apiKey: decrypt(user.own_key_enc), model: user.own_model || OWN_DEFAULT_MODEL };
  }
  throw new HttpError(401, "gate", "Choose how to pay for AI to continue.");
}

export type ChatContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatContent | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }

export class AiRequestError extends HttpError {
  constructor(status: number, code: string, message: string, public detail: string, topUpUrl: string | null = null) {
    super(status, code, message, topUpUrl);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One OpenAI-compatible chat completion. Returns the assistant text. Throws HttpError with a user-facing message. */
export async function chat(p: Provider, messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const body = JSON.stringify({
    model: p.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1800,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  });
  if (Buffer.byteLength(body) > MAX_BYTES) {
    throw new HttpError(413, "too_large", "That's too big to read in one go. Try a smaller file or paste the important part.");
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    checkDeadline();
    let res: Response;
    try {
      res = await providerFetch(p, `${p.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` },
        body,
        signal: requestSignal(60_000),
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      checkDeadline();
      if (attempt === 0) { await sleep(1500); continue; }
      throw new HttpError(503, "ai_unreachable", p.kind === "publik" ? "publik is not reachable. Check your connection." : "Your AI provider is not reachable right now. Try again in a moment.");
    }
    const text = await res.text();
    let parsed: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { parsed = JSON.parse(text); } catch { /* non-JSON error page */ }
    if (res.ok) {
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) return content.map((c: { text?: string }) => c.text ?? "").join("");
      throw new HttpError(502, "ai_error", "The AI returned an empty answer. Please try again.");
    }
    if (res.status === 402) {
      const t = topUpUrlFrom402(parsed);
      throw new AiRequestError(402, "payment_required", t.message, text.slice(0, 500), t.url);
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(1500); continue; }
    const detail = parsed.error?.message ?? text.slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      if (p.kind === "own") throw new AiRequestError(401, "own_key_invalid", "Your own AI key was rejected. Update it in Settings.", detail);
      throw new AiRequestError(401, "gate", "Sign in with publik to continue.", detail);
    }
    if (res.status === 429) throw new AiRequestError(429, "rate_limited", "Too many requests right now. Wait a few seconds and try again.", detail);
    if (res.status >= 500) throw new AiRequestError(503, "ai_unavailable", "The AI is having trouble right now. Please try again in a minute.", detail);
    throw new AiRequestError(502, "ai_error", "The AI couldn't process this. Please try again.", detail);
  }
  throw new HttpError(503, "ai_unavailable", "The AI is having trouble right now. Please try again in a minute.");
}

/** OpenAI-compatible streaming tool call. Text is sent to the caller as it arrives. */
export async function streamChat(
  p: Provider, messages: ChatMessage[], tools: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[],
  onText: (delta: string) => void, opts: { maxTokens?: number; toolChoice?: "none" } = {},
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const body = JSON.stringify({ model: p.model, messages, tools, stream: true, temperature: 0.2, max_tokens: opts.maxTokens ?? 1800, ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}) });
  if (Buffer.byteLength(body) > MAX_BYTES) throw new HttpError(413, "too_large", "That conversation is too large. Start a new chat.");
  let res: Response;
  try {
    res = await providerFetch(p, `${p.baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` }, body, signal: requestSignal(90_000),
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    checkDeadline();
    throw new HttpError(503, "ai_unreachable", p.kind === "publik" ? "publik is not reachable. Check your connection." : "Your AI provider is not reachable right now.");
  }
  if (!res.ok) {
    const raw = await res.text();
    let parsed: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { parsed = JSON.parse(raw); } catch { /* non-JSON response */ }
    if (res.status === 402) {
      const t = topUpUrlFrom402(parsed);
      throw new AiRequestError(402, "payment_required", t.message, raw.slice(0, 500), t.url);
    }
    const detail = parsed.error?.message ?? raw.slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new AiRequestError(401, p.kind === "own" ? "own_key_invalid" : "gate", p.kind === "own" ? "Your own AI key was rejected. Update it in Settings." : "Sign in with publik to continue.", detail);
    if (res.status === 429) throw new AiRequestError(429, "rate_limited", "Too many requests right now. Wait a few seconds and try again.", detail);
    if (res.status >= 500) throw new AiRequestError(503, "ai_unavailable", "The AI is having trouble right now. Please try again in a minute.", detail);
    throw new AiRequestError(502, "ai_error", "The AI couldn't process this. Please try again.", detail);
  }
  if (!res.body) throw new HttpError(502, "ai_error", "The AI returned an empty answer. Please try again.");
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "", content = "";
  const calls = new Map<number, ToolCall>();
  const consume = (line: string) => {
    if (!line.startsWith("data: ") || line === "data: [DONE]") return;
    let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { data = JSON.parse(line.slice(6)); } catch { return; }
    const delta = data.choices?.[0]?.delta;
    if (typeof delta?.content === "string") { content += delta.content; onText(delta.content); }
    for (const part of delta?.tool_calls ?? []) {
      const index = part.index ?? 0;
      const call = calls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(index, call);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) consume(line.trimEnd());
  }
  if (buffer) consume(buffer.trimEnd());
  return { content, toolCalls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) };
}

/** Pull the first JSON object out of a model reply (tolerates code fences and chatter). */
export function parseJsonObject(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf("{");
  if (start < 0) throw new Error("no JSON object");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object");
}

/** Validate a minimal OpenAI-compatible key: GET /models, then a 1-token chat as a fallback. */
export async function validateOwnKey(baseURL: string, apiKey: string, model: string): Promise<void> {
  const base = baseURL.replace(/\/$/, "");
  try {
    const r = await providerFetch({ kind: "own" }, `${base}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: requestSignal(15_000) });
    await r.body?.cancel();
    if (r.ok) return;
    if (r.status === 401 || r.status === 403) throw new HttpError(400, "own_key_invalid", "That key was rejected by the provider. Check it and try again.");
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  try {
    await chat({ kind: "own", baseURL: base, apiKey, model }, [{ role: "user", content: "Reply with OK." }], { maxTokens: 5 });
  } catch (e) {
    throw new HttpError(400, "own_key_invalid", e instanceof HttpError && e.code === "own_key_invalid" ? "That key was rejected by the provider. Check it and try again." : "We couldn't reach the AI with that key and model. Check the base URL, key and model name.");
  }
}
