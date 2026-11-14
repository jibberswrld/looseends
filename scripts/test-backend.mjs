import { randomUUID } from "node:crypto";
// Isolated built-app smoke tests. No .env loading, production database, real AI or Composio.
// Run after pnpm build: node scripts/test-backend.mjs. --serve keeps the fixture up for browser checks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";

const dir = await mkdtemp(join(tmpdir(), "looseends-backend-"));
const appPort = 4781, publikPort = 4782, connectorPort = 4783, aiPort = 4784;
const origin = `http://localhost:${appPort}`, connector = `http://localhost:${connectorPort}`;
const children = [], requests = [];
let logs = "", cookie = "", extractionDelay = 0;
const env = {
  PATH: process.env.PATH, NODE_ENV: "production", LOOSEENDS_DATA_DIR: dir,
  PUBLIK_ORIGIN: `http://localhost:${publikPort}`, PUBLIK_APP_TOKEN: "pat_mocktoken",
  CONNECTOR_ORIGIN: connector, MOCK_PUBLIK_PORT: String(publikPort), MOCK_CONNECTOR_PORT: String(connectorPort),
  MOCK_UPSTREAM_BASE_URL: `http://localhost:${aiPort}`, MOCK_UPSTREAM_MODEL: "publik-balanced",
};
function child(args) {
  const p = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => { logs = (logs + d).slice(-12_000); });
  p.stderr.on("data", (d) => { logs = (logs + d).slice(-12_000); });
  children.push(p); return p;
}
const json = (res, data) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
const tool = (name, args) => ({ id: `call_${name}_${Math.random()}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const fakeAI = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const b = JSON.parse(Buffer.concat(chunks)); requests.push(b);
  if (!b.stream) {
    if (extractionDelay) await new Promise((resolve) => setTimeout(resolve, extractionDelay));
    const extraction = String(b.messages[0].content).includes("own to-do queue")
      ? { answer: "Review your mock task.", task_ids: [] }
      : { title: "Mock email", classification: "obligations", tasks: [{ title: "Review mock message", next_step: "Review the source", evidence_quote: "Please reply to this email to confirm your appointment", confidence: 0.9 }] };
    return json(res, { choices: [{ message: { content: JSON.stringify(extraction) } }] });
  }
  const last = b.messages.at(-1);
  const user = b.messages.findLast((m) => m.role === "user")?.content ?? "";
  let calls = [], content = "Mock tool flow completed.";
  if (b.tool_choice !== "none") {
    if (last.role === "user") {
      if (user === "test local limits") calls = [tool("create_task", { title: "Approved local task" }), tool("check_inbox", {}), tool("check_inbox", {}), tool("find_todos_in_text", { text: "Please review the mock document." }), tool("create_task", { title: "Must not run" })];
      else calls = [tool("find_tools", { query: user === "test connected write" ? "gmail send" : "gmail fetch" })];
    } else if (last.role === "tool" && b.messages.some((m) => m.tool_calls?.some((t) => t.function.name === "find_tools")) && !b.messages.some((m) => m.tool_calls?.some((t) => t.function.name === "run_tool"))) {
      const meta = JSON.parse(last.content);
      assert(meta.some((t) => t.slug === (user === "test connected write" ? "GMAIL_SEND_EMAIL" : "GMAIL_FETCH_EMAILS")));
      assert(last.content.length < 10_000);
      assert(meta[0].parameters.required.length > 0);
      calls = [tool("run_tool", user === "test connected write" ? { tool: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "mock@example.test", subject: "Fixture", body: "Only a mock." }, title: "Send mock email" } : { tool: "GMAIL_FETCH_EMAILS", arguments: { max_results: 1, query: "in:inbox" } })];
    }
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: calls.length ? { tool_calls: calls.map((c, index) => ({ ...c, index })) } : { content } }] })}\n\ndata: [DONE]\n\n`);
});
async function ready(url) {
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(url)).ok) return; } catch { /* process starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Fixture failed to start: ${url}`);
}
async function api(path, method = "GET", body) {
  const res = await fetch(`${origin}${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const text = await res.text();
  const data = res.headers.get("content-type")?.includes("ndjson") ? text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(text);
  return { status: res.status, data };
}
async function stopApp() {
  const p = children.find((p) => p.spawnargs.includes("node_modules/next/dist/bin/next"));
  if (p && p.exitCode === null) { p.kill("SIGTERM"); await once(p, "exit"); }
}
try {
  fakeAI.listen(aiPort, "127.0.0.1"); await once(fakeAI, "listening");
  child(["scripts/mock-publik.mjs"]); child(["scripts/mock-connector.mjs"]);
  await Promise.all([ready(`${connector}/mock/calls`), ready(`http://localhost:${publikPort}/mock/402/off`)]);
  child(["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(appPort)]);
  await ready(origin);
  if (process.argv.includes("--serve")) {
    console.log(`Isolated mock app ready: ${origin}`);
    await new Promise((resolve) => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  } else {
    const unauth = await api("/api/agent", "POST", { message: "test connected read" }); assert.equal(unauth.status, 401);
    const gate = await api("/api/gate"); assert.equal(gate.data.state, "sign_in");
    await fetch(`${gate.data.claimUrl}?handle=backendtest`);
    assert.equal((await api("/api/gate")).data.state, "choose");
    assert.equal((await api("/api/gate/choice", "POST", { choice: "publik" })).data.state, "ready");
    console.log("PASS mock Publik sign-in and cookieless API denial");
    for (const app of ["gmail", "slack"]) {
      const link = await api("/api/connections/link", "POST", { toolkit: app }); assert.equal(link.status, 200);
      await fetch(link.data.url);
    }
    const read = await api("/api/agent", "POST", { message: "test connected read" });
    assert(read.data.some((e) => e.type === "done")); assert(!read.data.some((e) => e.type === "error"));
    assert.equal(read.data.filter((e) => e.type === "step" && e.step.status === "done").length, 2);
    assert(requests.every((r) => r.model === "publik-balanced"));
    console.log("PASS balanced-model find_tools → run_tool read with compact, valid schemas");
    const write = await api("/api/agent", "POST", { message: "test connected write" });
    const pending = write.data.find((e) => e.type === "action").action;
    assert.equal(pending.status, "pending"); assert.equal((await (await fetch(`${connector}/mock/calls`)).json()).calls.length, 0);
    const approvals = await Promise.all([api(`/api/agent/actions/${pending.id}`, "POST", { decision: "approve" }), api(`/api/agent/actions/${pending.id}`, "POST", { decision: "approve" })]);
    assert(approvals.some((r) => r.data.some((e) => e.type === "action" && e.action.status === "done")));
    assert.equal((await (await fetch(`${connector}/mock/calls`)).json()).calls.length, 1);
    console.log("PASS connected write waits for approval; racing approvals execute once");
    const before = await api("/api/tasks");
    const local = await api("/api/agent", "POST", { message: "test local limits" });
    const localActions = local.data.filter((e) => e.type === "action").map((e) => e.action);
    assert.equal(localActions.length, 3); assert.equal(localActions.filter((a) => a.tool === "LOOSEENDS_LOCAL_check_inbox").length, 1);
    assert.deepEqual((await api("/api/tasks")).data, before.data);
    const created = localActions.find((a) => a.tool === "LOOSEENDS_LOCAL_create_task");
    const localApproval = await api(`/api/agent/actions/${created.id}`, "POST", { decision: "approve" });
    assert(localApproval.data.some((e) => e.type === "action" && e.action.status === "done"));
    console.log("PASS four-call round cap, one inbox proposal per turn, local writes require approval");
    extractionDelay = 150;
    const scans = await Promise.all([api("/api/inbox/scan", "POST"), api("/api/inbox/scan", "POST")]);
    assert(scans.some((r) => r.data.some((e) => e.code === "scan_in_progress")));
    const scanned = scans.flatMap((r) => r.data).find((e) => e.type === "done"); assert.equal(scanned.scanned, 5);
    extractionDelay = 0;
    const repeat = await api("/api/inbox/scan", "POST"); assert.equal(repeat.data.find((e) => e.type === "done").skipped, 5);
    console.log("PASS concurrent inbox scan rejected; five emails imported; repeat skips all five");
    for (let i = 0; i < 17; i++) assert.equal((await api("/api/inbox/scan", "POST")).status, 200);
    const limited = await api("/api/inbox/scan", "POST"); assert.equal(limited.status, 429); assert.match(limited.data.error.message, /20 per hour/);
    console.log("PASS scan request 21 returns HTTP 429 with a clear hourly limit");
    const ownURL = await api("/api/me", "PATCH", { ownKey: { baseUrl: "https://127.0.0.1/v1", apiKey: randomUUID() } });
    assert.equal(ownURL.status, 400); assert.equal(ownURL.data.error.code, "invalid_provider_url");
    assert.equal((await fetch(`${origin}/api/connector/status`)).status, 404);
    console.log("PASS hosted own-key loopback rejection; public connector route removed");
    await fetch(`${connector}/mock/fail/on`);
    const failedDelete = await api("/api/me", "DELETE"); assert.equal(failedDelete.status, 502);
    assert.equal((await api("/api/me")).data.handle, "backendtest");
    await fetch(`${connector}/mock/fail/off`);
    assert.deepEqual((await api("/api/me", "DELETE")).data, { ok: true });
    const state = await (await fetch(`${connector}/api/connector/status`, { headers: { "x-mock-user": "looseends_backendtest" } })).json();
    assert(state.apps.every((a) => !a.connected)); assert.equal((await api("/api/me")).status, 401);
    await stopApp();
    const pg = await PGlite.create(join(dir, "db"));
    for (const table of ["users", "sessions", "sources", "tasks", "actions", "agent_messages", "agent_actions", "events", "rate_limits"]) assert.equal((await pg.query(`select count(*)::int as n from ${table}`)).rows[0].n, 0);
    await pg.close();
    console.log("PASS deletion failure preserves account; success disconnects every mock app and cascades all user data");
  }
} catch (e) {
  console.error(e); console.error("Fixture logs (mock data only):\n" + logs); process.exitCode = 1;
} finally {
  for (const p of children) if (p.exitCode === null) { p.kill("SIGTERM"); await once(p, "exit"); }
  fakeAI.closeAllConnections(); await new Promise((resolve) => fakeAI.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
