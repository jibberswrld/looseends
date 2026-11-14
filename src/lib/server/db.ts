import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { dataDir } from "./local";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

// Share initialization across module copies. PGlite must only open its data directory once.
const g = globalThis as unknown as { __looseendsDb?: Promise<PGlite>; __looseendsSchema?: Promise<void>; __looseendsNeon?: ReturnType<typeof neon> };

function schema() { return readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"); }

function hostedDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = (g.__looseendsNeon ??= neon(url));
  g.__looseendsSchema ??= (async () => {
    const statements = schema().split("-- statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    await client.transaction(statements.map((statement) => client.query(statement, [])), { fetchOptions: { signal: AbortSignal.timeout(20_000) } });
  })().catch((e) => { g.__looseendsSchema = undefined; throw e; });
  return { client, ready: g.__looseendsSchema };
}

function db(): Promise<PGlite> {
  g.__looseendsDb ??= (async () => {
    const pg = await PGlite.create(join(dataDir(), "db"));
    await pg.exec(schema());
    return pg;
  })().catch((e) => {
    g.__looseendsDb = undefined;
    throw e;
  });
  return g.__looseendsDb;
}

/** Tagged-template query: values are always sent as parameters. */
export async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  const text = strings.reduce((acc, s, i) => acc + (i ? `$${i}` : "") + s, "");
  return query(text, values);
}

/** Parameterized query with $1..$n placeholders (for dynamic UPDATE column lists). */
export async function query(text: string, params: unknown[]): Promise<Row[]> {
  const values = params.map(param);
  if (process.env.DATABASE_URL) {
    const { client, ready } = hostedDb();
    await ready;
    return (await client.query(text, values, { fetchOptions: { signal: AbortSignal.timeout(15_000) } })) as Row[];
  }
  if (process.env.VERCEL) throw new Error("DATABASE_URL must be set on Vercel.");
  return (await (await db()).query<Row>(text, values)).rows;
}

/** Arrays become Postgres array literals (for `= any($1::uuid[])`); other objects become JSON. */
function param(v: unknown): unknown {
  if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}
