/**
 * Server startup — the dispatcher.
 *
 * Next compiles this file for **both** the Node.js and the Edge runtime, so it
 * must stay trivially portable: only a runtime check and a dynamic import. Every
 * Node-specific thing — `process.on`, the worker pool, the backup timer, the
 * filesystem — lives in `./instrumentation-node`, which the Edge compilation
 * never has to parse.
 *
 * `register()` runs once per server process before traffic is served, which is
 * the only reliable place to start background work. The worker pool used to be
 * started lazily by whichever request arrived first, so a redeploy with jobs
 * queued sat idle until somebody opened a page.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Never during `next build`: it imports server modules to collect route
  // metadata, and starting workers or timers on the build machine would be a
  // side effect of building.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { registerNode } = await import("./instrumentation-node");
  await registerNode();
}
