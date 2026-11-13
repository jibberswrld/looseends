import { neon } from "@neondatabase/serverless";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

let client: ReturnType<typeof neon> | null = null;
function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

/** Tagged-template query: values are always sent as parameters. */
export async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  return (await db()(strings, ...values)) as Row[];
}

/** Parameterized query with $1..$n placeholders (for dynamic UPDATE column lists). */
export async function query(text: string, params: unknown[]): Promise<Row[]> {
  return (await db().query(text, params)) as Row[];
}
