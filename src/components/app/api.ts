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
