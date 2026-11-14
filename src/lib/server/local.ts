// Local development fallback when DATABASE_URL is unset and the server is not on Vercel.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** LOOSEENDS_DATA_DIR overrides (tests). */
export function dataDir(): string {
  const os = platform();
  const dir =
    process.env.LOOSEENDS_DATA_DIR ||
    (os === "darwin"
      ? join(homedir(), "Library", "Application Support", "LooseEnds")
      : os === "win32"
        ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "LooseEnds")
        : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "looseends"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** A random secret for local development when APP_SECRET is unset. */
export function localSecret(): string {
  const file = join(dataDir(), "secret.key");
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
    } catch {
      /* created by a concurrent request */
    }
  }
  chmodSync(file, 0o600);
  return readFileSync(file, "utf8").trim();
}
