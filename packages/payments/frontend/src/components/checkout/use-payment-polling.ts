import { useEffect, useState } from "react";

import { pollOrderStatus } from "./client";
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
}

/** Consecutive poll errors tolerated before giving up (avoids an infinite spinner). */
const MAX_POLL_ERRORS = 4;

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
  { intervalMs = 2500, enabled = true, maxHealthyPolls }: PollingOptions = {},
): { status: OrderStatus | null; error: string | null; timedOut: boolean } {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

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
      const result = await pollOrderStatus(orderId);
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
      }, intervalMs);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [orderId, intervalMs, enabled, maxHealthyPolls]);

  return { status, error, timedOut };
}
