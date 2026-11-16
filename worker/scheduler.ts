/**
 * Scheduling primitives for the worker's background passes. The worker loop
 * used to hand-track five "last run" timestamps and repeat the same
 * try/catch/console.error block around every task; a scheduled task now owns
 * its interval and its error handling, and the loop just calls `maybeRun`.
 */

export interface ScheduledTask {
  readonly name: string;
  /**
   * Runs the task if its schedule is due at `now` (ms epoch). Resolves to
   * whether the task actually ran; a failure is logged, never thrown, so one
   * broken pass cannot kill the worker loop.
   */
  maybeRun(now: number): Promise<boolean>;
}

export type TaskLogger = {
  log: (message: string) => void;
  error: (message: string, error: unknown) => void;
};

/** The worker's `[worker]`-prefixed console logger. */
export const workerLogger: TaskLogger = {
  log: (message) => console.log(`[worker] ${message}`),
  error: (message, error) => console.error(`[worker] ${message}`, error),
};

/**
 * A task that runs at most once per interval. The first call runs immediately,
 * matching the previous `lastX = 0` semantics where every pass was due on
 * worker start.
 */
export function createIntervalTask(
  name: string,
  intervalMs: number,
  run: () => Promise<void>,
  logger: TaskLogger = workerLogger,
): ScheduledTask {
  let lastRun = -Infinity;

  return {
    name,
    async maybeRun(now: number): Promise<boolean> {
      if (now - lastRun < intervalMs) return false;
      lastRun = now;
      try {
        await run();
      } catch (error) {
        logger.error(`could not run ${name}`, error);
      }
      return true;
    },
  };
}

/**
 * A task that runs once per UTC day at a fixed hour, plus immediately after a
 * start that happens after that hour — the semantics the daily Backup pass
 * always had. `schedule` must be idempotent per day.
 */
export function createDailyTask(
  name: string,
  hourUtc: number,
  run: () => Promise<void>,
  logger: TaskLogger = workerLogger,
): ScheduledTask {
  let nextRunAt = 0;

  return {
    name,
    async maybeRun(now: number): Promise<boolean> {
      if (now < nextRunAt) return false;
      nextRunAt = nextUtcSlot(now, hourUtc);
      try {
        await run();
      } catch (error) {
        logger.error(`could not run ${name}`, error);
      }
      return true;
    },
  };
}

/**
 * The next moment `hourUtc` strikes, in ms. If today's slot already passed,
 * that is tomorrow's — the caller runs immediately either way, so a restart
 * after 02:00 UTC still schedules that day.
 */
export function nextUtcSlot(nowMs: number, hourUtc: number): number {
  const now = new Date(nowMs);
  const slot = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc);
  return slot <= nowMs ? slot + 24 * 60 * 60 * 1_000 : slot;
}
