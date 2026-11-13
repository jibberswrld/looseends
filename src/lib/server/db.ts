import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { dataDir } from "./local";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

// Embedded Postgres (PGlite) stored in the app-data folder. One instance per process: a data
// directory must never be opened twice, so the handle lives on globalThis across module copies.
const g = globalThis as unknown as { __looseendsDb?: Promise<PGlite> };

function db(): Promise<PGlite> {
  g.__looseendsDb ??= (async () => {
    const pg = await PGlite.create(join(dataDir(), "db"));
    await pg.exec(readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"));
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
  const res = await (await db()).query<Row>(text, params.map(param));
  return res.rows;
}

/** Arrays become Postgres array literals (for `= any($1::uuid[])`); other objects become JSON. */
function param(v: unknown): unknown {
  if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}
