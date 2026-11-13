// Applies db/schema.sql. Usage: pnpm db:migrate  (reads .env.local via --env-file)
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const statements = schema
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter(Boolean);
for (const s of statements) await sql.query(s);
console.log(`migrated: ${statements.length} statements`);
