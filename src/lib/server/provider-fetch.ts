import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { HttpError } from "./http";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

const publicIP = (address: string) => isIP(address) === 4
  ? !blocked.check(address, "ipv4")
  : isIP(address) === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
const invalid = () => new HttpError(400, "invalid_provider_url", "Use an HTTPS AI provider URL on a public host. Private addresses and redirects aren't allowed.");

/** Pin the validated DNS answer to the socket, preventing DNS rebinding between validation and fetch. */
export async function providerFetch(provider: { kind: "publik" | "own" }, input: string, init: RequestInit): Promise<Response> {
  if (provider.kind !== "own" || (!process.env.VERCEL && !process.env.DATABASE_URL && process.env.NODE_ENV !== "production")) return fetch(input, { ...init, redirect: "error" });
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw invalid();
  init.signal?.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const addresses = await Promise.race([
    isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookup(host, { all: true }),
    new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(init.signal?.reason);
      init.signal?.addEventListener("abort", onAbort, { once: true });
    }),
  ]).finally(() => { if (onAbort) init.signal?.removeEventListener("abort", onAbort); });
  init.signal?.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !publicIP(address))) throw invalid();
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal ?? undefined,
      lookup(_hostname, options, callback) {
        // Node's family autoselection requests all answers; both forms use the same checked IP.
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
    }, (res) => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400) { res.destroy(); reject(invalid()); return; }
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
    });
    req.on("error", reject);
    req.end(init.body ?? undefined);
  });
}
