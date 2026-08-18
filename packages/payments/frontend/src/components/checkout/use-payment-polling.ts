import { useEffect, useState } from "react";

import { useCheckoutClientApi } from "./client-context";
import { TERMINAL_STATUSES, type OrderStatus } from "./types";

interface PollingOptions {
  /** Delay between polls (ms). */
  intervalMs?: number;
  /** Poll only while `true` (e.g. after a card charge is submitted). */
  enabled?: boolean;
  /**
   * Opt-in bound on successful non-terminal polls (FUT-191): stop scheduling and
   * report `timedOut` once this many healthy AWAITING responses arrive.
   * Undefined ⇒ unbounded, today's behavior (the PIX consumer passes no cap).
   */
  maxHealthyPolls?: number;
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

/** Consecutive poll errors tolerated before giving up (avoids an infinite spinner). */
const MAX_POLL_ERRORS = 4;

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
function pollDelay(healthy: number, options: PollingOptions): number {
  const { intervalMs = 2500, slowAfterPolls, slowIntervalMs } = options;
  const backingOff =
    slowAfterPolls !== undefined && slowIntervalMs !== undefined && healthy >= slowAfterPolls;
  return backingOff ? slowIntervalMs : intervalMs;
}

/**
 * Poll an order's payment status until it reaches a terminal state.
 *
 * Uses a self-scheduling `setTimeout` (never overlapping requests) that stops as
 * soon as the order is PAID/FAILED/EXPIRED, and tears down on unmount or when the
 * order id changes. This is the client half of the async confirmation the
 * PagSeguro webhook drives on the server.
 */
export function usePaymentPolling(
  orderId: string | null,
  {
    intervalMs = 2500,
    enabled = true,
    maxHealthyPolls,
    slowAfterPolls,
    slowIntervalMs,
  }: PollingOptions = {},
): { status: OrderStatus | null; error: string | null; timedOut: boolean } {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // Whichever mount this tree is bound to (FUT-741). Stable per provider, so it
  // belongs in the deps below rather than being read out of a ref: a checkout
  // re-pointed at another mount must re-poll against THAT one.
  const client = useCheckoutClientApi();

  useEffect(() => {
    if (!orderId || !enabled) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errorCount = 0;
    let healthyCount = 0;
    setTimedOut(false);
    setError(null);

    const tick = async (): Promise<void> => {
      const result = await client.getStatus(orderId);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        errorCount = 0;
        setStatus(result.data);
        if (TERMINAL_STATUSES.includes(result.data)) {
          return; // terminal — stop polling
        }
        healthyCount += 1;
        if (maxHealthyPolls !== undefined && healthyCount >= maxHealthyPolls) {
          // A healthy-but-still-AWAITING stream never trips the error cap, so
          // bound it separately (FUT-191): stop scheduling and let the consumer
          // show a "taking longer" state instead of an infinite spinner.
          setTimedOut(true);
          return;
        }
      } else {
        errorCount += 1;
        if (errorCount >= MAX_POLL_ERRORS) {
          // Give up rather than spin forever; surface the error to the consumer.
          setError(result.error);
          return;
        }
      }
      timer = setTimeout(() => {
        void tick();
      }, pollDelay(healthyCount, { intervalMs, slowAfterPolls, slowIntervalMs }));
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [orderId, intervalMs, enabled, maxHealthyPolls, slowAfterPolls, slowIntervalMs, client]);

  return { status, error, timedOut };
}
