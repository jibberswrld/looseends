// Behavior tests against actual server modules, transpiled into disposable scratch space.
// Only session context and outbound vendor responses are faked. No .env files are loaded.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

assert(!process.env.DATABASE_URL && !process.env.COMPOSIO_API_KEY && !process.env.VERCEL, "Run with DATABASE_URL, COMPOSIO_API_KEY and VERCEL unset.");
const scratch = await mkdtemp(join(tmpdir(), "looseends-limits-"));
process.env.LOOSEENDS_DATA_DIR = join(scratch, "data");
const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
let pg;
try {
  await symlink(resolve("node_modules"), join(scratch, "node_modules"));
  for (const file of await readdir("src/lib/server")) {
    if (!file.endsWith(".ts")) continue;
    let source = await readFile(join("src/lib/server", file), "utf8");
    if (file === "session.ts") source = 'export const requireReady = async () => globalThis.__backendCtx; export const sessionKey = () => "fixture-only";';
    source = source.replace('import pkg from "../../../package.json";', 'const pkg = { version: "test" };');
    const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/from "\.\/([^".]+)"/g, 'from "./$1.mjs"')
      .replace(/from "next\/(server|headers)"/g, 'from "next/$1.js"');
    await writeFile(join(scratch, file.replace(/\.ts$/, ".mjs")), result);
  }
  const load = (file) => import(pathToFileURL(join(scratch, `${file}.mjs`)).href);
  const { sql } = await load("db");
  const { rateLimit } = await load("rate-limit");
  const { messages, converse, decideAction } = await load("agent");
  const { scanInbox } = await load("inbox");
  const { capture } = await load("capture");
  const { providerFetch } = await load("provider-fetch");
  const user = (await sql`insert into users (publik_handle) values ('limits-test') returning *`)[0];
  const session = { id: "fixture-session", ai_choice: "publik", publik_base_url: "http://127.0.0.1:1" };
  const ctx = { user, session }; globalThis.__backendCtx = ctx;
  pg = await globalThis.__looseendsDb;
  await pg.exec(await readFile("db/schema.sql", "utf8"));
  // Mirrors the hosted loader's explicit boundaries; no SQL parsing on semicolons.
  for (const statement of (await readFile("db/schema.sql", "utf8")).split("-- statement-breakpoint").filter((s) => s.trim())) await pg.exec(statement);
  console.log("PASS additive schema reapplies both whole-file and explicit-statement paths");
  const races = await Promise.allSettled(Array.from({ length: 80 }, () => rateLimit(user.id, "agent")));
  assert.equal(races.filter((r) => r.status === "fulfilled").length, 60);
  assert(races.filter((r) => r.status === "rejected").every((r) => r.reason.status === 429));
  await sql`update rate_limits set window_start = now() - interval '1 hour' where user_id = ${user.id}`;
  await rateLimit(user.id, "agent");
  assert.equal((await sql`select count from rate_limits where user_id = ${user.id} and bucket = 'agent'`)[0].count, 1);
  const other = (await sql`insert into users (publik_handle) values ('other-user') returning *`)[0]; await rateLimit(other.id, "agent");
  for (const [bucket, limit] of [["capture", 60], ["ask", 60], ["scan", 20]]) {
    const outcomes = await Promise.allSettled(Array.from({ length: limit + 3 }, () => rateLimit(user.id, bucket)));
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, limit);
  }
  console.log("PASS atomic concurrent limits for all four buckets, hourly rollover and user isolation");
  const m = (await sql`insert into agent_messages (user_id, role) values (${user.id}, 'assistant') returning *`)[0];
  const stale = (await sql`insert into agent_actions (user_id, message_id, app, tool, title, summary, args, status, started_at) values (${user.id}, ${m.id}, 'gmail', 'GMAIL_SEND_EMAIL', 'Old action', '', '{}', 'running', now() - interval '6 minutes') returning *`)[0];
  const recent = (await sql`insert into agent_actions (user_id, message_id, app, tool, title, summary, args, status, started_at) values (${user.id}, ${m.id}, 'gmail', 'GMAIL_SEND_EMAIL', 'Recent action', '', '{}', 'running', now()) returning *`)[0];
  await messages(user.id);
  assert.equal((await sql`select status from agent_actions where id = ${stale.id}`)[0].status, "failed");
  assert.equal((await sql`select status from agent_actions where id = ${recent.id}`)[0].status, "running");
  console.log("PASS five-minute stale-action sweep preserves recent running actions");
  process.env.CONNECTOR_ORIGIN = "http://localhost:4666";
  let gmailCalls = 0, holdAI = false;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/status")) return Response.json({ gmail: true, googlecalendar: false, apps: [{ slug: "gmail", name: "Gmail", connected: true }] });
    if (String(input).endsWith("/run")) { gmailCalls++; return Response.json({ data: { messages: [] } }); }
    if (holdAI) return new Promise((_, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "Fixture", classification: "no_action", tasks: [] }) } }] });
  };
  await sql`update users set scan_started_at = now() where id = ${user.id}`;
  const freshScan = []; for await (const e of scanInbox(ctx)) freshScan.push(e);
  assert.equal(freshScan[0].code, "scan_in_progress"); assert.equal(gmailCalls, 0);
  await sql`update users set scan_started_at = now() - interval '6 minutes' where id = ${user.id}`;
  for await (const e of scanInbox(ctx)) assert.notEqual(e.type, "error");
  assert.equal(gmailCalls, 1); assert.equal((await sql`select scan_started_at from users where id = ${user.id}`)[0].scan_started_at, null);
  console.log("PASS fresh scan lease blocks work, expired lease recovers and releases");
  const input = { kind: "gmail", text: "Same external message", title: null, fileName: null, force: true, gmail: { from: "Fixture", address: null, externalId: "same-id", threadId: null } };
  const captures = await Promise.all([capture(ctx, input), capture(ctx, input)]);
  assert.equal(captures.filter((r) => r.outcome === "duplicate_source").length, 1);
  assert.equal((await sql`select count(*)::int as n from sources where external_id = 'same-id'`)[0].n, 1);
  console.log("PASS racing duplicate-source insert skips without a generic server error");
  holdAI = true;
  // Accelerates the production 240s timeout without adding a runtime configuration option.
  AbortSignal.timeout = (ms) => originalTimeout(ms === 240_000 ? 40 : ms);
  const events = []; await converse(ctx, "Slow AI fixture", (e) => events.push(e));
  assert(events.some((e) => e.type === "done"));
  const saved = (await messages(user.id)).find((m) => m.role === "assistant" && /time limit/.test(m.text)); assert(saved);
  assert(saved.steps.every((s) => s.status !== "running"));
  const pending = (await sql`insert into agent_actions (user_id, message_id, app, tool, title, summary, args) values (${user.id}, ${m.id}, 'looseends', 'LOOSEENDS_LOCAL_find_todos_in_text', 'Extract fixture', '', '{"text":"Slow extraction fixture"}') returning *`)[0];
  await sql`delete from rate_limits where user_id = ${user.id} and bucket = 'capture'`;
  const approved = []; await decideAction(ctx, pending.id, "approve", undefined, (e) => approved.push(e));
  assert.equal((await sql`select status from agent_actions where id = ${pending.id}`)[0].status, "failed");
  assert(approved.some((e) => e.type === "done"));
  console.log("PASS aborted conversation persists a clean ending; timed-out approval becomes failed");
  AbortSignal.timeout = originalTimeout;
  process.env.NODE_ENV = "production";
  globalThis.fetch = () => { throw new Error("Blocked provider must never reach fetch"); };
  for (const url of ["http://example.com/v1", "https://127.0.0.1/v1", "https://10.0.0.1/v1", "https://172.16.0.1/v1", "https://169.254.169.254/v1", "https://[::1]/v1", "https://[::ffff:127.0.0.1]/v1", "https://[fe80::1]/v1", "https://[fc00::1]/v1", "https://user:pass@example.com/v1", "https://localhost/v1"]) {
    await assert.rejects(providerFetch({ kind: "own" }, url, { signal: originalTimeout(500) }), (e) => e.code === "invalid_provider_url");
  }
  console.log("PASS hosted own-key HTTP, credentials, loopback, private and link-local rejection");
} finally {
  globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout;
  if (pg) await pg.close();
  await rm(scratch, { recursive: true, force: true });
}
