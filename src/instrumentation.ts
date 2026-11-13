// PUBLIK_SELF_TEST=1 <start command> prints `publik self-test: ok looseends <version>` once a real GET /wallet
// answers, then exits. publik's setup skill runs the built app this way to prove the gate is wired.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PUBLIK_SELF_TEST) {
    await import("./instrumentation-node");
  }
}
