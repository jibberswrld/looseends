// Local stand-in for publikhq.com, for end-to-end tests of the Sign in with publik gate.
// Run: MOCK_UPSTREAM_BASE_URL=... MOCK_UPSTREAM_API_KEY=... node scripts/mock-publik.mjs
// Then start the app with PUBLIK_ORIGIN=http://localhost:4555 PUBLIK_APP_TOKEN=pat_mocktoken.
// Endpoints: POST /api/v1/installs, GET /api/v1/wallet, POST /api/v1/telemetry, POST /api/v1/chat/completions,
// GET /claim/<install_id>[?handle=name] (visiting it "signs in"). Never used in production.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.MOCK_PUBLIK_PORT || 4555);
const ORIGIN = `http://localhost:${PORT}`;
const UPSTREAM = (process.env.MOCK_UPSTREAM_BASE_URL || "").replace(/\/$/, "");
const UPSTREAM_KEY = process.env.MOCK_UPSTREAM_API_KEY || "";
const UPSTREAM_MODEL = process.env.MOCK_UPSTREAM_MODEL || "gpt-4o-mini";
const BALANCE = Number(process.env.MOCK_BALANCE_MICROS ?? 50_000);

let force402 = false; // GET /mock/402/on|off toggles an empty-balance answer for chat
const installs = new Map(); // install_id -> { key, claimed, handle }
const byKey = new Map(); // key -> install_id

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});
const auth = (req) => {
  const h = req.headers.authorization || "";
  const key = h.startsWith("Bearer ") ? h.slice(7) : null;
  const id = key && byKey.get(key);
  return id ? { id, inst: installs.get(id) } : null;
};

createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  try {
    if (req.method === "POST" && url.pathname === "/api/v1/installs") {
      const b = JSON.parse(await readBody(req));
      if (!String(b.app_token || "").startsWith("pat_")) return send(res, 401, { error: { type: "invalid_token", message: "Unknown app token." } });
      const id = b.install_id;
      let inst = installs.get(id);
      if (inst) return send(res, 200, { install_id: id, base_url: `${ORIGIN}/api/v1`, claim_url: `${ORIGIN}/claim/${id}` }); // no key on repeat, like publik
      inst = { key: `pk_test_${randomBytes(12).toString("hex")}`, claimed: false, handle: null };
      installs.set(id, inst);
      byKey.set(inst.key, id);
      console.log(`[mock] install ${id} os=${b.os} device="${b.device_name}" slug=${b.app_slug} v=${b.app_version}`);
      return send(res, 201, { key: inst.key, install_id: id, base_url: `${ORIGIN}/api/v1`, claim_url: `${ORIGIN}/claim/${id}` });
    }
    if (req.method === "GET" && url.pathname.startsWith("/claim/")) {
      const id = url.pathname.slice(7);
      const inst = installs.get(id);
      if (!inst) { res.writeHead(404); return res.end("unknown install"); }
      inst.claimed = true;
      inst.handle = url.searchParams.get("handle") || "testuser";
      console.log(`[mock] claimed ${id} as @${inst.handle}`);
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><title>mock publik</title><p>Signed in to mock publik as @${inst.handle}. You can close this tab.</p>`);
    }
    if (req.method === "GET" && url.pathname.startsWith("/mock/402/")) { force402 = url.pathname.endsWith("/on"); return send(res, 200, { force402 }); }
    if (req.method === "GET" && url.pathname.startsWith("/unclaim/")) { const i = installs.get(url.pathname.slice(9)); if (i) i.claimed = false; return send(res, 200, { ok: !!i }); }
    if (req.method === "GET" && url.pathname === "/api/v1/wallet") {
      const a = auth(req);
      if (!a) return send(res, 401, { error: { message: "Invalid key." } });
      return send(res, 200, {
        claim_state: a.inst.claimed ? "claimed" : "anonymous",
        claim_url: `${ORIGIN}/claim/${a.id}`,
        account: a.inst.claimed ? { handle: a.inst.handle } : null,
        plan: { kind: "none", label: null },
        balance_micros: a.inst.claimed ? BALANCE : 0,
        top_up_url: `${ORIGIN}/wallet`,
        linked_at: a.inst.claimed ? new Date().toISOString() : null,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/v1/telemetry") {
      const b = JSON.parse(await readBody(req));
      console.log(`[mock] telemetry ${b.event} app=${b.app} install=${b.install_id} auth=${auth(req) ? "yes" : "no"}`);
      return send(res, 202, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      const a = auth(req);
      if (!a) return send(res, 401, { error: { message: "Invalid key." } });
      if (!a.inst.claimed) return send(res, 402, { error: { message: "Link this computer to publik to use AI.", top_up_url: `${ORIGIN}/claim/${a.id}` } });
      if (force402) return send(res, 402, { error: { message: "Your publik balance is empty.", top_up_url: `${ORIGIN}/wallet` } });
      if (!UPSTREAM) return send(res, 503, { error: { message: "mock has no upstream" } });
      const b = JSON.parse(await readBody(req));
      console.log(`[mock] chat model=${b.model} msgs=${b.messages?.length}`);
      b.model = UPSTREAM_MODEL;
      const up = await fetch(`${UPSTREAM}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${UPSTREAM_KEY}` }, body: JSON.stringify(b) });
      res.writeHead(up.status, { "content-type": "application/json", "x-publik-charge-micros": "1000" });
      return res.end(await up.text());
    }
    send(res, 404, { error: { message: "not found" } });
  } catch (e) {
    send(res, 500, { error: { message: String(e) } });
  }
}).listen(PORT, () => console.log(`[mock] publik on ${ORIGIN}`));
