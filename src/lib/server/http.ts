import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public topUpUrl: string | null = null) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, ...(e.topUpUrl ? { topUpUrl: e.topUpUrl } : {}) } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json({ error: { code: "invalid_request", message: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } }, { status: 400 });
  }
  console.error("[api]", e);
  return NextResponse.json({ error: { code: "server_error", message: "Something went wrong on our side. Please try again." } }, { status: 500 });
}

/** Wrap a route handler so thrown HttpErrors / validation errors become ApiError JSON. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
