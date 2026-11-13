import { writeSync } from "node:fs";
import { selfTest } from "./lib/server/publik";

// Loaded only in the Node.js runtime when PUBLIK_SELF_TEST is set (see instrumentation.ts).
writeSync(1, `${await selfTest()}\n`);
process.exit(0);
