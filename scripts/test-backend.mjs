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
    if (String(b.messages[0].content).includes("sort a person's recent emails")) {
      // Inbox triage sees metadata only; this stand-in picks the senders a person is waiting on.
      const list = JSON.parse(String(b.messages[1].content).match(/<emails>\n([\s\S]*)\n<\/emails>/)[1]);
      return json(res, { choices: [{ message: { content: JSON.stringify({ pick: list.filter((e) => /Riverside|Okafor|City Power/.test(e.from)).map((e) => e.id) }) } }] });
    }
    if (extractionDelay) await new Promise((resolve) => setTimeout(resolve, extractionDelay));
    if (String(b.messages[0].content).startsWith("You write short, clear, polite replies")) {
      return json(res, { choices: [{ message: { content: JSON.stringify({ to: "frontdesk@riversidedental.com", subject: "Re: Please confirm your cleaning", body: "Hi,\n\nI confirm my cleaning on Thursday. I'll fill in the intake form before my visit.\n\nThanks!" }) } }] });
    }
    const source = String(b.messages[1]?.content ?? "");
    if (source.includes("Please confirm your appointment for Thursday by 3 p.m.")) {
      // The built-in "Try a sample email" message, answered the way the real extractor does (for screenshots).
      const now = new Date(), thursday = new Date(now.getTime() + (((4 - now.getUTCDay() + 7) % 7) || 7) * 86_400_000).toISOString().slice(0, 10);
      return json(res, { choices: [{ message: { content: JSON.stringify({ classification: "obligations", title: "Email from Riverside Dental", summary: "Riverside Dental asks you to confirm Thursday's cleaning and fill in an intake form.", tasks: [
        { title: "Confirm your Thursday cleaning", next_step_type: "reply", next_step: "Reply to Riverside Dental to confirm", evidence_quote: "Please confirm your appointment for Thursday by 3 p.m.", due_text: "Thursday by 3 p.m.", due_date: thursday, due_time: "15:00", due_kind: "relative", priority: "high", confidence: 0.95, recipient: "frontdesk@riversidedental.com" },
        { title: "Complete the intake form", next_step_type: "form", next_step: "Fill in the intake form before your visit", evidence_quote: "complete the intake form before your visit", due_text: "before your visit", due_date: null, due_kind: "vague", confidence: 0.9 },
      ] }) } }] });
    }
    const extraction = String(b.messages[0].content).includes("own to-do queue")
      ? { answer: "Review your mock task.", task_ids: [] }
      : { title: "Mock email", classification: "obligations", tasks: [{ title: "Review mock message", next_step: "Review the source", evidence_quote: "Please reply to this email to confirm your appointment", confidence: 0.9 }] };
    return json(res, { choices: [{ message: { content: JSON.stringify(extraction) } }] });
  }
  const last = b.messages.at(-1);
  const user = b.messages.findLast((m) => m.role === "user")?.content ?? "";
  let calls = [], content = user === "What needs a reply?" ? "**Riverside Dental** is waiting on you: they asked you to confirm Thursday's cleaning by replying to their email. I added it to your list." : "Mock tool flow completed.";
  if (b.tool_choice !== "none") {
    if (last.role === "user") {
      if (user === "What needs a reply?") calls = [tool("list_tasks", {}), tool("check_inbox", {})];
      else if (user.startsWith("test local removals ")) calls = [tool("complete_task", { id: user.split(" ").at(-1) }), tool("dismiss_task", { id: user.split(" ").at(-1) })];
      else if (user === "test local limits") calls = [tool("create_task", { title: "Approved local task" }), tool("check_inbox", {}), tool("check_inbox", {}), tool("find_todos_in_text", { text: "Please review the mock document." }), tool("create_task", { title: "Must not run" })];
      else if (user === "test long title") calls = [tool("create_task", { title: "T".repeat(121) })];
      else if (user === "test long next step") calls = [tool("create_task", { title: "Short", nextStep: "N".repeat(301) })];
      else if (user === "test boundary task") calls = [tool("create_task", { title: "T".repeat(120), nextStep: "N".repeat(300) })];
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
    const gate = await api("/api/gate", "POST"); assert.equal(gate.data.state, "sign_in"); // POST creates the session and install
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
    const tasksBeforeInvalid = (await api("/api/tasks")).data;
    for (const [message, limit] of [["test long title", 120], ["test long next step", 300]]) {
      const result = await api("/api/agent", "POST", { message });
      assert(!result.data.some((e) => e.type === "action" || e.type === "tasks"));
      const feedback = requests.at(-1).messages.findLast((m) => m.role === "tool");
      assert.match(feedback.content, new RegExp(`${limit} characters or fewer`));
    }
    assert.deepEqual((await api("/api/tasks")).data, tasksBeforeInvalid);
    const boundary = await api("/api/agent", "POST", { message: "test boundary task" });
    assert(!boundary.data.some((e) => e.type === "action"));
    const savedTask = boundary.data.find((e) => e.type === "tasks").tasks[0];
    assert.equal(savedTask.title, "T".repeat(120)); assert.equal(savedTask.nextStep, "N".repeat(300));
    console.log("PASS overlong task proposals tell the model to shorten and save nothing; a boundary-length task saves exactly");
    extractionDelay = 150;
    const scans = await Promise.all([api("/api/inbox/scan", "POST"), api("/api/inbox/scan", "POST")]);
    assert(scans.some((r) => r.data.some((e) => e.code === "scan_in_progress")));
    const scanned = scans.flatMap((r) => r.data).find((e) => e.type === "done");
    assert.equal(scanned.scanned, 25); assert.equal(scanned.found, 3);
    assert.equal(scanned.summary, "Checked 25 recent emails: 3 new to-dos, 22 with nothing to do.");
    assert.equal(requests.filter((r) => !r.stream && String(r.messages[0].content).includes("sort a person's recent emails")).length, 1);
    assert.deepEqual(scans.flatMap((r) => r.data).filter((e) => e.type === "email").map((e) => e.from), ["Riverside Dental", "Maya Okafor", "City Power & Light"]);
    extractionDelay = 0;
    const beforeRepeat = requests.filter((r) => !r.stream).length;
    const repeat = await api("/api/inbox/scan", "POST");
    const repeatDone = repeat.data.find((e) => e.type === "done");
    assert.equal(repeatDone.skipped, 25); assert.equal(repeatDone.scanned, 0); assert.equal(repeatDone.summary, "No new emails to check.");
    assert.equal(requests.filter((r) => !r.stream).length - beforeRepeat, 0);
    console.log("PASS concurrent inbox scan rejected; 25 mock emails, one triage call, three real obligations read; repeat finds nothing new");
    const before = (await api("/api/tasks")).data.tasks;
    const local = await api("/api/agent", "POST", { message: "test local limits" });
    assert(!local.data.some((e) => e.type === "action"), "Adding tasks, finding to-dos and checking the inbox run without approval cards");
    const created = local.data.filter((e) => e.type === "tasks").flatMap((e) => e.tasks);
    assert(created.some((t) => t.title === "Approved local task")); assert(!created.some((t) => t.title === "Must not run"));
    assert(created.some((t) => t.title === "Review mock message"), "find_todos_in_text ran through the capture pipeline");
    const feedback = requests.findLast((r) => r.stream && r.messages.some((m) => m.role === "tool")).messages.filter((m) => m.role === "tool").map((m) => m.content).join("\n");
    assert.match(feedback, /only be checked once per turn/); assert.match(feedback, /Only four tool calls/); assert.match(feedback, /No new emails to check/);
    const refreshed = local.data.find((e) => e.type === "connections");
    assert(refreshed && refreshed.connections.gmail.lastScanAt, "An agent inbox check refreshes the last-checked time");
    assert.equal((await api("/api/tasks")).data.tasks.length, before.length + created.length);
    console.log("PASS create_task, check_inbox and find_todos_in_text run at once; round cap and one inbox check per turn hold; last-checked refreshes");
    const target = created.find((t) => t.title === "Approved local task");
    const removal = await api("/api/agent", "POST", { message: `test local removals ${target.id}` });
    const removalCards = removal.data.filter((e) => e.type === "action").map((e) => e.action);
    assert.deepEqual(removalCards.map((a) => [a.tool, a.status]), [["LOOSEENDS_LOCAL_complete_task", "pending"], ["LOOSEENDS_LOCAL_dismiss_task", "pending"]]);
    assert.equal((await api("/api/tasks")).data.tasks.find((t) => t.id === target.id).status, "reviewed");
    const completed = await api(`/api/agent/actions/${removalCards[0].id}`, "POST", { decision: "approve" });
    assert.equal(completed.data.find((e) => e.type === "tasks").tasks[0].status, "completed");
    console.log("PASS complete_task and dismiss_task still wait for approval and only change the task once approved");
    for (let i = 0; i < 16; i++) assert.equal((await api("/api/inbox/scan", "POST")).status, 200);
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
