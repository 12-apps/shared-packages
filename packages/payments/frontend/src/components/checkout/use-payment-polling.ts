import { useCallback, useEffect, useRef, useState } from "react";

import { useCheckoutClientApi } from "./client-context";
import { useCheckoutCopy } from "./copy-context";
import { createPollLoop, type PollLoop, type PollingOptions } from "./poll-loop";
import type { OrderStatus } from "./types";

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
  // The buyer's own sentence for "we could not reach the server", reused for an
  // ask abandoned for hanging. `Result.error` is rendered verbatim by the PIX,
  // card and wallet panels, so without this a hang printed the English token
  // `timeout` into a Portuguese screen.
  const transportCopy = useCheckoutCopy().screens.transport;
  // The live wait, so the returned action stays stable across renders while
  // still reaching whichever loop the effect currently owns.
  const loop = useRef<PollLoop | null>(null);

  useEffect(() => {
    if (!orderId || !enabled) return undefined;

    const running = createPollLoop(
      () => client.getStatus(orderId),
      {
        intervalMs,
        maxWaitMs,
        slowAfterPolls,
        slowIntervalMs,
        askTimeoutMs,
        askTimeoutError: transportCopy.offline,
      },
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
    }, [
    orderId,
    intervalMs,
    enabled,
    maxWaitMs,
    slowAfterPolls,
    slowIntervalMs,
    askTimeoutMs,
    client,
    transportCopy,
  ]);

  const checkAgain = useCallback(() => {
    loop.current?.restart();
  }, []);

  return { status, error, timedOut, checkAgain };
}

