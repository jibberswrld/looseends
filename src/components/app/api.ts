"use client";

import type { ApiError } from "@/lib/types";

export class ApiFailure extends Error {
  code: string;
  status: number;
  topUpUrl: string | null;
  constructor(status: number, code: string, message: string, topUpUrl: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.topUpUrl = topUpUrl;
  }
}

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Fetch a LooseEnds API route. Throws ApiFailure with the server's readable message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        "x-timezone": timezone(),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "network", "You're offline or LooseEnds can't be reached. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    const e = body?.error;
    throw new ApiFailure(
      res.status,
      e?.code ?? "error",
      e?.message ?? `Something went wrong (${res.status}). Try again.`,
      e?.topUpUrl ?? null,
    );
  }
  return body as T;
}

/** POST to a route that answers with NDJSON, calling `onEvent` for each line as it arrives. Throws ApiFailure on a non-2xx. */
export async function streamNdjson<E>(path: string, json: unknown, onEvent: (e: E) => void, fallback = "Something went wrong. Try again."): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-timezone": timezone() },
      body: JSON.stringify(json ?? {}),
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "network", "You're offline or LooseEnds can't be reached. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => null)) as Partial<ApiError> | null;
    throw new ApiFailure(res.status, b?.error?.code ?? "error", b?.error?.message ?? fallback, b?.error?.topUpUrl ?? null);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as E);
}
