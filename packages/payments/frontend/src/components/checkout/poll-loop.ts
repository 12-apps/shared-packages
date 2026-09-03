import type { Result } from "../../result";
import { TERMINAL_STATUSES, type OrderStatus } from "./types";

/**
 * ONE self-scheduling wait for a payment to settle, with no React in it.
 *
 * Split out of `use-payment-polling.ts` so the hook there is what it reads as:
 * an effect that owns a loop for the length of an order id. Everything here is
 * the loop itself — the backoff, the wall clock, the per-ask timeout and the
 * attempt counter that lets a hung request be abandoned rather than waited on.
 */

export interface PollingOptions {
  /** Delay between successful polls (ms). */
  intervalMs?: number;
  /**
   * How long one ask may hang before it is abandoned (ms). Defaults to
   * {@link DEFAULT_ASK_TIMEOUT_MS}; consumers override it only in tests.
   */
  askTimeoutMs?: number;
  /** Poll only while `true` (e.g. after a card charge is submitted). */
  enabled?: boolean;
  /**
   * WALL-CLOCK bound on the whole wait (FUT-1144): stop scheduling and report
   * `timedOut` once this many milliseconds have passed since the wait began.
   * Undefined ⇒ unbounded (the PIX consumer passes none — its charge expires
   * server-side and comes back as a terminal EXPIRED).
   *
   * It used to be a count of HEALTHY polls, which measured the wrong thing in
   * the only case that matters. A wait that is failing makes no healthy polls,
   * so the count stood still while the clock ran: the hosted-return leg spun
   * "Confirmando seu pagamento…" forever on a connection that never came back,
   * because the only counter that could have stopped it was the one the
   * failure had frozen. Wall time cannot be frozen by the failure it measures.
   */
  maxWaitMs?: number;
  /**
   * Opt-in BACKOFF: after this many healthy polls, keep asking at
   * {@link slowIntervalMs} instead of {@link intervalMs}.
   *
   * A single interval cannot serve a long wait, because the two things it
   * decides pull opposite ways. It is how fast a buyer WHO PAID learns that
   * they did — every poll is a provider round trip, and the answer lands within
   * seconds of the webhook — and it is also what an abandoned checkout costs
   * for the rest of the window. Tuning one picks the other's loser: a slow
   * interval taxes the common case (the person on this screen almost always
   * paid) to subsidise the rare one.
   *
   * Splitting them costs neither. Both must be set for backoff to apply.
   */
  slowAfterPolls?: number;
  slowIntervalMs?: number;
}

/**
 * The slowest a failing poll may go (FUT-1144).
 *
 * Consecutive failures double the delay — 2.5 s, 5 s, 10 s — and stop there.
 * The cap is what keeps the recovery cheap: a shopper whose signal comes back
 * during a Wi-Fi→4G handoff waits at most this long to be told they paid, and
 * the two re-arm events below usually beat it outright.
 */
const MAX_ERROR_BACKOFF_MS = 10_000;

/**
 * How long a re-arm must stay quiet after the last ask.
 *
 * Returning to a tab commonly fires `visibilitychange` and `online` together —
 * and a shopper flicking between the bank app and the store fires them again
 * per trip. This collapses a burst into one request without delaying it: the
 * first re-arm of a burst polls immediately, the rest fall inside the gap.
 */
const REARM_QUIET_MS = 1_000;

/**
 * How long ONE status ask may take before the loop stops waiting on it.
 *
 * Comfortably longer than any healthy round trip on a bad link, so an ordinary
 * slow poll is never mistaken for a dead one; short enough that a socket that
 * died silently — the iOS case this whole feature exists for — costs one
 * backoff step rather than the rest of the wait.
 */
const DEFAULT_ASK_TIMEOUT_MS = 15_000;

/**
 * What a timed-out ask reports. It reads as any other transport failure
 * because that is what it is to everything downstream: the counters, the
 * backoff and the stalled-wait panel treat it exactly like a 500.
 */
const ASK_TIMED_OUT = "timeout";

/**
 * How long before the next ask, given how many healthy polls have happened.
 *
 * A pure function of the options, so it lives out here rather than inside the
 * effect — the hook is at its size gate, and a scheduling RULE is easier to
 * read (and to test) stated once than threaded through a closure.
 *
 * Reads the count AFTER the poll just made, so the slow phase begins on the
 * poll FOLLOWING the threshold rather than one early: a wait described as "N
 * fast polls" has to actually make N of them.
 */
function healthyDelay(healthy: number, options: PollingOptions): number {
  const { intervalMs = 2500, slowAfterPolls, slowIntervalMs } = options;
  const backingOff =
    slowAfterPolls !== undefined && slowIntervalMs !== undefined && healthy >= slowAfterPolls;
  return backingOff ? slowIntervalMs : intervalMs;
}

/**
 * The same rule with consecutive FAILURES folded in (FUT-1144).
 *
 * Errors never stop the wait, they only slow it. Doubling from the healthy
 * cadence is what makes a ten-second blip cost one extra beat instead of the
 * whole confirmation: four failures used to be terminal, and four failures is
 * what a Wi-Fi→4G handoff produces at the default 2.5 s.
 *
 * The cap is `MAX_ERROR_BACKOFF_MS` or the healthy cadence, whichever is
 * larger — a failing poll must never ask FASTER than a succeeding one, which
 * is what a bare cap would do to a consumer whose slow interval is longer.
 */
function pollDelay(healthy: number, errors: number, options: PollingOptions): number {
  const base = healthyDelay(healthy, options);
  if (errors === 0) return base;
  return Math.min(base * 2 ** (errors - 1), Math.max(base, MAX_ERROR_BACKOFF_MS));
}

/** Where a running wait writes what it has learned. */
interface PollSink {
  setStatus: (status: OrderStatus) => void;
  setError: (error: string | null) => void;
  setTimedOut: (timedOut: boolean) => void;
}

/**
 * The mutable bookkeeping one wait carries.
 *
 * `settled` and `stopped` are deliberately NOT the same flag. Settled means the
 * order reached a terminal status and there is nothing left to ask about, ever.
 * Stopped only means nothing is scheduled — which the wall clock running out
 * also produces, and which the buyer's own "check again" is allowed to undo.
 */
function newRun() {
  return {
    cancelled: false,
    settled: false,
    stopped: false,
    inFlight: false,
    /**
     * Which ask is the CURRENT one.
     *
     * A hung request cannot be un-sent, so it is abandoned instead: every ask
     * carries the attempt it belongs to, and a late answer from a superseded
     * attempt is dropped. Without this, `inFlight` stayed true for as long as
     * the socket did — and `inFlight` gates the tick, the re-arm AND the
     * buyer's own "check again", so one dead request disabled every mechanism
     * this loop has for recovering from a dead request.
     */
    attempt: 0,
    errors: 0,
    healthy: 0,
    startedAt: 0,
    askedAt: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  };
}

/** The mutable state of one wait — see {@link newRun}. */
type PollRun = ReturnType<typeof newRun>;

/**
 * Give up WAITING on one ask — never on the wait itself.
 *
 * Resolves as an ordinary failed poll, so a hang costs exactly what a 500
 * costs: the error counter rises, the backoff widens, and the next tick is
 * scheduled. `run.attempt` is what makes it safe — if the real answer lands
 * afterwards it belongs to a superseded attempt and is dropped.
 */
function askTimeout(
  run: PollRun,
  mine: number,
  options: PollingOptions,
): Promise<Result<OrderStatus>> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (run.attempt === mine) resolve({ ok: false, error: ASK_TIMED_OUT });
    }, options.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS);
  });
}

/**
 * Fold one poll's answer into the run and into what the screen says.
 *
 * Returns whether the wait continues. A TERMINAL status is the only answer
 * that can end it from here — the wall clock is the caller's business, because
 * it has to be consulted against the delay it is about to sleep for.
 */
function absorb(run: PollRun, result: Result<OrderStatus>, sink: PollSink): boolean {
  if (!result.ok) {
    run.errors += 1;
    sink.setError(result.error);
    return true;
  }
  run.errors = 0;
  sink.setError(null);
  sink.setStatus(result.data);
  if (TERMINAL_STATUSES.includes(result.data)) {
    run.settled = true;
    run.stopped = true;
    return false;
  }
  run.healthy += 1;
  return true;
}

/** The handle the hook holds on one running wait. */
export interface PollLoop {
  /** Reset the clock and the counters, then ask immediately. */
  restart: () => void;
  /** Ask immediately, keeping the clock — the re-arm events' entry point. */
  poke: () => void;
  /** Tear down: nothing further is scheduled and nothing further is written. */
  stop: () => void;
}

/**
 * One self-scheduling wait, with no React in it.
 *
 * A `setTimeout` chain rather than an interval, so requests never overlap; the
 * mutable counters live in one object because the flakiness gate's
 * `no-global-state-mutation` is about exactly this shape, and because the
 * whole loop has to be cancellable from a React cleanup.
 */
export function createPollLoop(
  ask: () => Promise<Result<OrderStatus>>,
  options: PollingOptions,
  sink: PollSink,
): PollLoop {
  const run = newRun();

  const clearPending = (): void => {
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.timer = undefined;
  };

  const outOfTime = (delay: number): boolean =>
    options.maxWaitMs !== undefined && Date.now() - run.startedAt + delay >= options.maxWaitMs;

  const tick = async (): Promise<void> => {
    if (run.cancelled || run.settled || run.inFlight) return;
    run.inFlight = true;
    run.askedAt = Date.now();
    const mine = ++run.attempt;
    // Bounded, because the wall clock below is only consulted once an ask
    // RETURNS: a request that never returns never reaches it, so the wait that
    // is supposed to end after `maxWaitMs` runs forever showing "we are still
    // trying". Racing a timer turns a hang into an ordinary failed poll, which
    // the backoff and the re-arm already know how to handle.
    const result = await Promise.race([ask(), askTimeout(run, mine, options)]);
    // A superseded attempt writes nothing: it may be a hung request finally
    // answering, long after a poke or a restart moved on.
    if (run.attempt !== mine) return;
    run.inFlight = false;
    if (run.cancelled || run.settled) return;
    if (!absorb(run, result, sink)) return;
    const delay = pollDelay(run.healthy, run.errors, options);
    if (outOfTime(delay)) {
      run.stopped = true;
      sink.setTimedOut(true);
      return;
    }
    clearPending();
    run.timer = setTimeout(() => void tick(), delay);
  };

  return {
    restart: (): void => {
      if (run.cancelled || run.settled) return;
      clearPending();
      // Same reasoning as `poke`, and this one is the buyer pressing a button:
      // "Verificar de novo" that cleared the panel and sent nothing — because
      // an ask was still notionally in flight — is the exact complaint.
      run.attempt += 1;
      run.inFlight = false;
      run.stopped = false;
      run.errors = 0;
      run.healthy = 0;
      run.startedAt = Date.now();
      sink.setTimedOut(false);
      sink.setError(null);
      void tick();
    },
    poke: (): void => {
      if (run.cancelled || run.stopped) return;
      if (Date.now() - run.askedAt < REARM_QUIET_MS) return;
      // Deliberately NOT gated on `inFlight`: the shopper who just came back
      // from their bank app is exactly the case where the previous ask is a
      // socket that died while the screen was hidden. Abandon it and ask now.
      run.attempt += 1;
      run.inFlight = false;
      clearPending();
      void tick();
    },
    stop: (): void => {
      run.cancelled = true;
      clearPending();
    },
  };
}
