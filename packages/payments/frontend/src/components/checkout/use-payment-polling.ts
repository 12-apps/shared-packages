import { useCallback, useEffect, useRef, useState } from "react";

import { useCheckoutClientApi } from "./client-context";
import type { Result } from "../../result";
import { TERMINAL_STATUSES, type OrderStatus } from "./types";

interface PollingOptions {
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

/** What a consumer reads off the wait, and the one action it can take. */
interface PaymentPollingState {
  status: OrderStatus | null;
  /**
   * The last poll failed. TRANSIENT (FUT-1144): the wait keeps running on a
   * backoff and this clears the moment a poll succeeds, so a consumer must
   * render it as "we are still trying", never as "we gave up".
   */
  error: string | null;
  /** The wall-clock bound elapsed — nothing further is scheduled. */
  timedOut: boolean;
  /**
   * Ask NOW, and start the wait over: the buyer's own "check again". Restarts
   * the clock too, so it is the way back from {@link timedOut}. A no-op once
   * the order has settled — there is nothing left to ask about.
   */
  checkAgain: () => void;
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

/** The handle the hook holds on one running wait. */
interface PollLoop {
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
function createPollLoop(
  ask: () => Promise<Result<OrderStatus>>,
  options: PollingOptions,
  sink: PollSink,
): PollLoop {
  const run = newRun();

  const clearPending = (): void => {
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.timer = undefined;
  };

  /**
   * Give up WAITING on one ask — never on the wait itself.
   *
   * Resolves as an ordinary failed poll, so a hang costs exactly what a 500
   * costs: the error counter rises, the backoff widens, and the next tick is
   * scheduled. `run.attempt` is what makes it safe — if the real answer lands
   * afterwards it belongs to a superseded attempt and is dropped.
   */
  const askTimeout = (mine: number): Promise<Result<OrderStatus>> =>
    new Promise((resolve) => {
      setTimeout(() => {
        if (run.attempt === mine) resolve({ ok: false, error: ASK_TIMED_OUT });
      }, options.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS);
    });

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
    const result = await Promise.race([ask(), askTimeout(mine)]);
    // A superseded attempt writes nothing: it may be a hung request finally
    // answering, long after a poke or a restart moved on.
    if (run.attempt !== mine) return;
    run.inFlight = false;
    if (run.cancelled || run.settled) return;
    if (result.ok) {
      run.errors = 0;
      sink.setError(null);
      sink.setStatus(result.data);
      if (TERMINAL_STATUSES.includes(result.data)) {
        run.settled = true;
        run.stopped = true;
        return;
      }
      run.healthy += 1;
    } else {
      run.errors += 1;
      sink.setError(result.error);
    }
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

/**
 * Ask again the moment the shopper could plausibly have an answer for us.
 *
 * Those two moments are exactly the ones this bug was reported from: a buyer
 * switching to their bank app (iOS aborts the in-flight fetches, and the tab
 * comes back `visible`), and a handset moving between Wi-Fi and 4G (`online`).
 * Waiting out the backoff after either is time spent not telling somebody
 * their payment landed.
 *
 * Guarded for a host with no DOM — this package is imported by SSR frames, and
 * a hook that throws at import time takes the whole checkout with it.
 */
function listenForRearm(poke: () => void): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return (): void => undefined;
  }
  const onVisible = (): void => {
    if (document.visibilityState === "visible") poke();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", poke);
  return (): void => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", poke);
  };
}

/**
 * Poll an order's payment status until it reaches a terminal state.
 *
 * Stops as soon as the order is PAID/FAILED/EXPIRED, when the wall-clock bound
 * elapses, and on unmount or an order-id change. This is the client half of the
 * async confirmation the provider's webhook drives on the server.
 *
 * A FAILED POLL IS NOT AN ENDING (FUT-1144). It slows the wait and is reported
 * as `error` so a screen can say so, and the next success clears it. The wait
 * ended for four consecutive errors once — ~10 s of no signal — and left a PIX
 * QR under a red alert with no retry, a card spinner replaced by one, and the
 * hosted return spinning forever. None of the three could recover on its own,
 * which is what made a blip cost a payment nobody was ever told about.
 */
export function usePaymentPolling(
  orderId: string | null,
  {
    intervalMs = 2500,
    enabled = true,
    maxWaitMs,
    slowAfterPolls,
    slowIntervalMs,
    askTimeoutMs,
  }: PollingOptions = {},
): PaymentPollingState {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // Whichever mount this tree is bound to (FUT-741). Stable per provider, so it
  // belongs in the deps below rather than being read out of a ref: a checkout
  // re-pointed at another mount must re-poll against THAT one.
  const client = useCheckoutClientApi();
  // The live wait, so the returned action stays stable across renders while
  // still reaching whichever loop the effect currently owns.
  const loop = useRef<PollLoop | null>(null);

  useEffect(() => {
    if (!orderId || !enabled) return undefined;

    const running = createPollLoop(
      () => client.getStatus(orderId),
      { intervalMs, maxWaitMs, slowAfterPolls, slowIntervalMs, askTimeoutMs },
      { setStatus, setError, setTimedOut },
    );
    loop.current = running;
    running.restart();
    const unlisten = listenForRearm(running.poke);

    return () => {
      unlisten();
      running.stop();
      loop.current = null;
    };
  }, [orderId, intervalMs, enabled, maxWaitMs, slowAfterPolls, slowIntervalMs, askTimeoutMs, client]);

  const checkAgain = useCallback(() => {
    loop.current?.restart();
  }, []);

  return { status, error, timedOut, checkAgain };
}
