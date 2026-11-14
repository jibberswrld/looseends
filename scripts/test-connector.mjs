import { randomUUID } from "node:crypto";
// Exercises the production in-process path with an in-process Composio SDK fake.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import ts from "typescript";

assert(!process.env.DATABASE_URL && !process.env.COMPOSIO_API_KEY && !process.env.VERCEL, "Run with production configuration unset.");
const scratch = await mkdtemp(join(tmpdir(), "looseends-connector-"));
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.mjs"');
const calls = [], deleted = [];
let failDelete = false, failTool = false;
globalThis.__sdkFixture = {
  async create(userId, _config, options) { assert(options.signal); calls.push(userId); return new globalThis.__sdkFixture.Session(); },
  Session: class {
    async toolkits(_options, request) { assert(request.signal); return { items: [{ slug: "gmail", name: "Gmail", connection: { isActive: true } }] }; }
    async authorize(_toolkit, options, request) { assert(request.signal); assert.match(options.callbackUrl, /\/connected\?app=gmail$/); return { redirectUrl: "https://authorize.example.test" }; }
    async search(_query, request) { assert(request.signal); return { results: [{ primaryToolSlugs: ["GMAIL_FETCH_EMAILS"], relatedToolSlugs: [] }] }; }
    async execute(slug, args, _options, request) { assert(request.signal); calls.push({ slug, args }); return failTool ? { resultType: "failed", error: "sensitive vendor error must never be logged" } : { resultType: "completed", data: { messages: [{ messageText: "Fixture email", payload: {}, attachmentList: [] }] } }; }
  },
  tools: { async getRawComposioToolBySlug(slug, _options, request) { assert(request.signal); return { slug, name: "Fixture", toolkit: { slug: slug === "FORBIDDEN" ? "unsupported" : "gmail" }, inputParameters: { type: "object" }, tags: ["readOnlyHint"] }; } },
  connectedAccounts: {
    async list(query, request) { assert(request.signal); assert.deepEqual(query.userIds, ["looseends_session-owner"]); assert.equal(query.toolkitSlugs, undefined); return query.cursor ? { items: [{ id: "second-page" }], nextCursor: null } : { items: [{ id: "first-page" }], nextCursor: "page-2" }; },
    async delete(id, request) { assert(request.signal); if (failDelete) throw new Error("sensitive delete error"); deleted.push(id); },
  },
};
try {
  await symlink(resolve("node_modules"), join(scratch, "node_modules"));
  for (const name of ["composio", "connector", "deadline", "http"]) {
    let source = await readFile(`src/lib/server/${name}.ts`, "utf8");
    source = source.replace('import { Composio, ToolRouterSession } from "@composio/core";', 'const ToolRouterSession = globalThis.__sdkFixture.Session; class Composio { tools = globalThis.__sdkFixture.tools; connectedAccounts = globalThis.__sdkFixture.connectedAccounts; create = globalThis.__sdkFixture.create; }');
    source = source.replace('import { headers } from "next/headers";', 'const headers = async () => new Headers({host: "app.example.test"});');
    source = source.replace('from "next/server"', 'from "next/server.js"');
    await writeFile(join(scratch, `${name}.mjs`), compile(source));
  }
  await writeFile(join(scratch, "session.mjs"), 'export const requireReady = async () => ({user: {publik_handle: "session-owner"}});');
  const connector = await import(pathToFileURL(join(scratch, "connector.mjs")));
  // Hosted settings ensure CONNECTOR_ORIGIN cannot redirect this path to any HTTP mock.
  process.env.VERCEL = "1"; process.env.CONNECTOR_ORIGIN = "http://localhost:1";
  process.env.COMPOSIO_API_KEY = randomUUID();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Production connector must not HTTP-fetch itself"); };
  try {
    assert((await connector.connectorStatus()).data.gmail);
    assert.equal((await connector.connectorLink("gmail")).data.url, "https://authorize.example.test");
    assert.equal((await connector.connectorTools("fetch gmail")).data.tools[0].slug, "GMAIL_FETCH_EMAILS");
    const run = await connector.connectorRun("GMAIL_FETCH_EMAILS", { user_id: "another-person" });
    assert(run.ok); assert(!Object.hasOwn(run.data.data.messages[0], "payload"));
    assert.equal(calls.find((c) => typeof c === "object").args.user_id, "me");
    assert(calls.filter((c) => typeof c === "string").every((c) => c === "looseends_session-owner"));
    assert.equal((await connector.connectorRun("FORBIDDEN", {})).ok, false);
    failTool = true; assert.equal((await connector.connectorRun("GMAIL_FETCH_EMAILS", {})).code, "tool_failed");
    assert((await connector.connectorDisconnectAll()).ok); assert.deepEqual(deleted, ["first-page", "second-page"]);
    failDelete = true;
    const oldError = console.error; const errors = []; console.error = (...args) => errors.push(args.join(" "));
    try { assert.equal((await connector.connectorDisconnectAll()).ok, false); } finally { console.error = oldError; }
    assert(errors.every((e) => !e.includes("sensitive")));
  } finally { globalThis.fetch = oldFetch; delete process.env.VERCEL; delete process.env.COMPOSIO_API_KEY; }
  console.log("PASS production connector uses session identity in-process; mock override ignored; mailbox and toolkit guards hold");
  console.log("PASS connected-account deletion paginates all accounts and surfaces failure without vendor error logging");

  let dnsAnswer = "93.184.216.34", status = 200, sent = 0;
  globalThis.__lookupFixture = async () => [{ address: dnsAnswer, family: 4 }];
  globalThis.__requestFixture = (_url, options, callback) => {
    sent++; const emitter = new EventEmitter();
    emitter.end = () => {
      options.lookup("provider.example.test", { all: true }, (error, answers) => { assert.ifError(error); assert.equal(answers[0].address, "93.184.216.34"); });
      const response = Readable.from([Buffer.from("provider fixture")]); response.statusCode = status; response.headers = status === 302 ? { location: "http://127.0.0.1/private" } : {};
      callback(response);
    };
    return emitter;
  };
  let source = await readFile("src/lib/server/provider-fetch.ts", "utf8");
  source = source.replace('import { lookup } from "node:dns/promises";', 'const lookup = globalThis.__lookupFixture;').replace('import { request } from "node:https";', 'const request = globalThis.__requestFixture;');
  await writeFile(join(scratch, "provider.mjs"), compile(source));
  const { providerFetch } = await import(pathToFileURL(join(scratch, "provider.mjs")));
  process.env.NODE_ENV = "production";
  assert.equal(await (await providerFetch({ kind: "own" }, "https://provider.example.test/v1", {})).text(), "provider fixture");
  status = 302;
  await assert.rejects(providerFetch({ kind: "own" }, "https://provider.example.test/v1", {}), (e) => e.code === "invalid_provider_url");
  assert.equal(sent, 2);
  dnsAnswer = "169.254.169.254";
  await assert.rejects(providerFetch({ kind: "own" }, "https://provider.example.test/v1", {}), (e) => e.code === "invalid_provider_url");
  assert.equal(sent, 2);
  console.log("PASS own-provider public response, pinned DNS, private DNS rejection and no redirect following (fake HTTPS transport)");
} finally { await rm(scratch, { recursive: true, force: true }); }
