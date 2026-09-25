import "server-only";

/**
 * Node-only server startup.
 *
 * Split out of `instrumentation.ts` because Next also compiles that file for the
 * Edge runtime, where `process.on` and the filesystem do not exist. Nothing here
 * is imported unless the runtime really is Node.
 */

const globalForBoot = globalThis as unknown as { __chessdadBooted?: boolean };

export async function registerNode(): Promise<void> {
  // Dev hot-reload calls `register()` again; the work below must happen once.
  if (globalForBoot.__chessdadBooted) return;
  globalForBoot.__chessdadBooted = true;

  const { log } = await import("@/lib/log");

  // A rejected promise escaping a background loop would otherwise take the whole
  // server down with no explanation in the log.
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled promise rejection", { err: reason });
  });
  process.on("uncaughtException", (err) => {
    log.error("uncaught exception — exiting", { err });
    // Exit: after an uncaught exception the process state is not trustworthy, and
    // the platform will restart it cleanly.
    process.exit(1);
  });

  try {
    const { bootProbe } = await import("@/lib/health");
    await bootProbe();
  } catch (e) {
    log.error("boot: probe failed", { err: e });
  }

  try {
    if (process.env.CHESSDAD_DISABLE_WORKER === "1") {
      log.warn("boot: worker disabled by CHESSDAD_DISABLE_WORKER=1 — queued jobs will not run");
    } else {
      const { ensureWorkerStarted, getWorkerState } = await import("@/lib/worker");
      ensureWorkerStarted();
      log.info("boot: worker pool started", getWorkerState());
    }
  } catch (e) {
    log.error("boot: could not start the worker pool — analysis will not run", { err: e });
  }

  try {
    const { startBackupScheduler } = await import("@/lib/backup");
    startBackupScheduler();
  } catch (e) {
    log.error("boot: could not start the backup scheduler", { err: e });
  }
}
