/**
 * Keeping background work alive in a process nobody is watching.
 *
 * A tab that throws shows a red line in a console somebody eventually opens. A
 * tray agent that throws shows an icon that looks exactly like the working one
 * — so the failure mode this module exists for is not a crash, it is a machine
 * that quietly stopped doing the job for three days.
 *
 * So: a task that returns is RESTARTED, a task that throws is restarted after
 * a backoff, and either way the host is told. The only thing that ends the
 * loop is {@link Supervisor.stop}.
 */

/** Exponential backoff between restarts. Milliseconds. */
export interface BackoffPolicy {
  initialMs: number;
  maxMs: number;
}

/**
 * The same shape `@12-apps/realtime`'s channel uses, and deliberately so: an
 * agent running several supervised loops against one host should not have them
 * retrying on different curves for no reason anybody can state.
 */
export const DEFAULT_BACKOFF: BackoffPolicy = { initialMs: 1_000, maxMs: 30_000 };

/**
 * The delay before attempt `attempt` (1-based), jittered.
 *
 * Half fixed, half random — the realtime client's curve. The fixed half is
 * what bounds one agent's retry rate; the random half is what stops a
 * neighbourhood of shops whose shared uplink blinked from reconnecting in
 * lockstep for ever afterwards.
 */
export function backoffDelay(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const uncapped = policy.initialMs * 2 ** Math.max(0, attempt - 1);
  const ceiling = Math.min(uncapped, policy.maxMs);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export interface SupervisorOptions {
  /**
   * The work. Runs until it returns, throws, or the signal aborts.
   *
   * It is handed an `AbortSignal` rather than a stop flag because everything
   * it is likely to wrap — `fetch`, a stream reader, a timer helper — already
   * takes one, and a loop that polls a boolean cannot be interrupted mid-await.
   */
  run: (signal: AbortSignal) => Promise<void>;
  /**
   * Told about every restart, with the reason and how many consecutive
   * failures have now happened. `undefined` reason means the task RETURNED —
   * which is not an error and is worth distinguishing, because a task that
   * keeps returning immediately is a different bug from one that keeps
   * throwing.
   */
  onRestart?: (reason: unknown | undefined, consecutiveFailures: number) => void;
  backoff?: BackoffPolicy;
  random?: () => number;
  /** Test seam. Defaults to the platform timer. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface Supervisor {
  /** Idempotent: a second call while running does nothing. */
  start(): void;
  /** Aborts the current run and resolves once the loop has left. */
  stop(): Promise<void>;
  readonly running: boolean;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? defaultSleep;
  let controller: AbortController | null = null;
  let loop: Promise<void> | null = null;

  async function cycle(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      let reason: unknown | undefined;
      let failed = false;
      try {
        await options.run(signal);
      } catch (error) {
        failed = true;
        reason = error;
      }
      if (signal.aborted) return;
      // A clean return resets the curve: the task did its job and ended, so
      // the next start is a fresh one rather than a retry. Only consecutive
      // FAILURES compound — which is what makes the delay mean "this is not
      // getting better" rather than "this has been running a while".
      failures = failed ? failures + 1 : 0;
      options.onRestart?.(reason, failures);
      // Still paused after a clean return, and on purpose: a `run` that
      // returns instantly — a stream refused before its first byte — would
      // otherwise spin this loop as fast as the event loop allows.
      await sleep(backoffDelay(Math.max(failures, 1), backoff, options.random), signal);
    }
  }

  return {
    start(): void {
      if (controller) return;
      const started = new AbortController();
      controller = started;
      loop = cycle(started.signal);
    },
    async stop(): Promise<void> {
      if (!controller) return;
      controller.abort();
      const pending = loop;
      controller = null;
      loop = null;
      await pending;
    },
    get running(): boolean {
      return controller !== null;
    },
  };
}
