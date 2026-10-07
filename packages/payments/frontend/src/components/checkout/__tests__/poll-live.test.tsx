// @vitest-environment jsdom
/**
 * FUT-649 — the payment wait hears the order move, when the host can hear it.
 *
 * The wait asks `/status` every 2.5 s because a webhook settles the order in
 * another process and asking was the only way to find out. A host holding a
 * realtime channel for this buyer now hands it in through
 * `CheckoutLiveProvider`: a hint asks at once, and while the channel is live the
 * wait keeps no timer at all (FUT-3223). What is pinned here:
 *
 *   - no provider, or `live: false` (a guest), polls exactly as before;
 *   - live, a healthy answer books nothing: no ask until something says to;
 *   - live, a FAILED ask still retries on its backoff, then idles once healthy;
 *   - a hosted-checkout return carrying the settlement pair keeps the floor;
 *   - a hint, a `visibilitychange` and the channel (re-)opening each ask once;
 *   - a hint asks NOW, even just after an ask (FUT-3205; `poll-hint.test.tsx`);
 *   - a channel that drops asks now and goes back to 2.5 s;
 *   - the wall clock is not reset by the channel flapping.
 */
import { act, render } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX } from "react";

import { CheckoutClientProvider } from "../client-context";
import { CheckoutLiveProvider, type CheckoutLiveSignal } from "../live-context";
import { withLive } from "../poll-live";
import type { CheckoutClient } from "../transport";
import type { OrderStatus } from "../types";
import { usePaymentPolling } from "../use-payment-polling";
import type { Result } from "../../../result";

const PENDING: Result<OrderStatus> = { ok: true, data: "AWAITING_PAYMENT" };
const PAID: Result<OrderStatus> = { ok: true, data: "PAID" };

/** A client that answers from a swappable reply, counting every ask. */
function countingClient(): {
  client: CheckoutClient;
  calls: () => number;
  answerWith: (next: Result<OrderStatus>) => void;
} {
  const world = { asked: 0, answer: PENDING };
  const client = {
    getStatus: async () => {
      world.asked += 1;
      return world.answer;
    },
  } as unknown as CheckoutClient;
  return {
    client,
    calls: () => world.asked,
    answerWith: (next) => {
      world.answer = next;
    },
  };
}

/** The host's channel: who is listening, and a way to fire it. */
function channel(): { subscribe: CheckoutLiveSignal["subscribe"]; hint: () => void } {
  const listeners = new Set<() => void>();
  return {
    subscribe: (onHint) => {
      listeners.add(onHint);
      return () => listeners.delete(onHint);
    },
    hint: () => listeners.forEach((listener) => listener()),
  };
}

function Probe({ maxWaitMs }: { maxWaitMs?: number }): JSX.Element {
  const { status, timedOut } = usePaymentPolling("o1", { maxWaitMs });
  return <output data-status={status ?? ""} data-timed-out={String(timedOut)} />;
}

function Harness({
  client,
  signal,
  maxWaitMs,
}: {
  client: CheckoutClient;
  signal: CheckoutLiveSignal | null;
  maxWaitMs?: number;
}): JSX.Element {
  const probe = <Probe maxWaitMs={maxWaitMs} />;
  return (
    <CheckoutClientProvider client={client}>
      {signal ? <CheckoutLiveProvider signal={signal}>{probe}</CheckoutLiveProvider> : probe}
    </CheckoutClientProvider>
  );
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The channel fires, from outside React. */
async function deliver(hint: () => void): Promise<void> {
  await act(async () => {
    hint();
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withLive", () => {
  it("stretches a delay to the floor only while live", () => {
    expect(withLive(2_500, { liveIntervalMs: 15_000, isLive: () => true })).toBe(15_000);
    expect(withLive(2_500, { liveIntervalMs: 15_000, isLive: () => false })).toBe(2_500);
    expect(withLive(2_500, {})).toBe(2_500);
  });

  it("never speeds up a slower cadence already in force", () => {
    expect(withLive(30_000, { liveIntervalMs: 15_000, isLive: () => true })).toBe(30_000);
  });
});

describe("the payment wait and the host's channel", () => {
  it("polls every 2.5 s with no provider, as before", async () => {
    const { client, calls } = countingClient();
    render(<Harness client={client} signal={null} />);
    await elapse(0);
    expect(calls()).toBe(1);

    await elapse(2_500);

    expect(calls()).toBe(2);
  });

  it("polls every 2.5 s for a guest, whose channel is never live", async () => {
    const { client, calls } = countingClient();
    const { subscribe } = channel();
    render(<Harness client={client} signal={{ live: false, subscribe }} />);
    await elapse(0);

    await elapse(2_500);

    expect(calls()).toBe(2);
  });

  it("asks once and then keeps no timer while live, however long it waits", async () => {
    const { client, calls } = countingClient();
    const { subscribe } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(0);
    expect(calls()).toBe(1);

    await elapse(120_000);

    expect(calls()).toBe(1);
  });

  it("keeps the live floor on a hosted return carrying the settlement pair", async () => {
    // Its own read is what confirms the payment there, and no server sweep can
    // stand in for it (`carriesSettlementPair`).
    window.history.replaceState(null, "", "/retorno?transaction_nsu=tx-1&slug=pay-1");
    try {
      const { client, calls } = countingClient();
      const { subscribe } = channel();
      render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
      await elapse(0);
      await elapse(2_500);
      expect(calls()).toBe(1);

      await elapse(12_500);

      expect(calls()).toBe(2);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("keeps no timer on a return carrying only half the pair", async () => {
    window.history.replaceState(null, "", "/retorno?transaction_nsu=tx-1");
    try {
      const { client, calls } = countingClient();
      const { subscribe } = channel();
      render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);

      await elapse(60_000);

      expect(calls()).toBe(1);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("retries a failed ask on its backoff while live, then idles once it answers", async () => {
    const { client, calls, answerWith } = countingClient();
    const { subscribe } = channel();
    answerWith({ ok: false, error: "boom" });
    render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(0);
    expect(calls()).toBe(1);

    await elapse(2_500);
    expect(calls()).toBe(2);
    answerWith(PENDING);
    await elapse(5_000);
    expect(calls()).toBe(3);

    await elapse(60_000);

    expect(calls()).toBe(3);
  });

  it("asks when the tab comes back while live and idle", async () => {
    const { client, calls } = countingClient();
    const { subscribe } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(30_000);
    expect(calls()).toBe(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls()).toBe(2);
  });

  it("asks once when the channel re-opens, and finds a payment whose hint was lost", async () => {
    const { client, calls, answerWith } = countingClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(10_000);
    view.rerender(<Harness client={client} signal={{ live: false, subscribe }} maxWaitMs={600_000} />);
    await elapse(1_200);
    answerWith(PAID); // settled while the channel was down: its hint is never heard
    const beforeReopen = calls();

    view.rerender(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(0);

    expect(calls()).toBe(beforeReopen + 1);
    expect(view.container.querySelector("output")?.getAttribute("data-status")).toBe("PAID");
  });

  it("asks when the channel first opens after the wait began, then idles", async () => {
    const { client, calls } = countingClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: false, subscribe }} maxWaitMs={600_000} />);
    await elapse(1_200);
    expect(calls()).toBe(1);

    view.rerender(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(0);
    expect(calls()).toBe(2);

    await elapse(60_000);

    expect(calls()).toBe(2);
  });

  it("defers a re-open that lands just after an ask by the quiet window, never drops it", async () => {
    const { client, calls } = countingClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: false, subscribe }} maxWaitMs={600_000} />);
    await elapse(2_500);
    expect(calls()).toBe(2);
    await elapse(100);

    view.rerender(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(999);
    expect(calls()).toBe(2);
    await elapse(1);

    expect(calls()).toBe(3);
    await elapse(60_000);
    expect(calls()).toBe(3);
  });

  it("asks the moment the channel says the order moved", async () => {
    const { client, calls, answerWith } = countingClient();
    const { subscribe, hint } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(5_000);
    answerWith(PAID);

    await deliver(hint);

    expect(calls()).toBe(2);
    expect(view.container.querySelector("output")?.getAttribute("data-status")).toBe("PAID");
  });

  it("asks at once for a hint that lands just after an ask", async () => {
    // The ask a moment ago may have been answered before the order moved, so
    // the hint is never swallowed. It used to wait out the re-arm quiet window,
    // a full second on the pay step with the answer already published
    // (FUT-3205); a hint is a server fact, not a `visibilitychange` burst.
    const { client, calls, answerWith } = countingClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(0);
    answerWith(PAID);

    await deliver(hint);
    expect(calls()).toBe(2);
  });

  it("asks now and returns to 2.5 s when the channel drops", async () => {
    const { client, calls } = countingClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(0);
    await elapse(2_500);
    expect(calls()).toBe(1);

    view.rerender(<Harness client={client} signal={{ live: false, subscribe }} />);
    await elapse(0);
    expect(calls()).toBe(2);

    await elapse(2_500);
    expect(calls()).toBe(3);
  });

  it("stays open to its last second while live, so a late hint still lands", async () => {
    // Ending a sleep early when it would cross the deadline is right with no
    // channel. Live, it handed a 90 s wait over at 75 s and refused the hint
    // that arrived at 80 s.
    const { client, answerWith } = countingClient();
    const { subscribe, hint } = channel();
    const view = render(
      <Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={90_000} />,
    );
    await elapse(80_000);
    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("false");
    answerWith(PAID);

    await deliver(hint);

    expect(view.container.querySelector("output")?.getAttribute("data-status")).toBe("PAID");
  });

  it("still times out at the wall clock while live", async () => {
    const { client } = countingClient();
    const { subscribe } = channel();
    const view = render(
      <Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={90_000} />,
    );
    await elapse(89_000);
    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("false");

    await elapse(1_000);

    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("true");
  });

  it("keeps the wall clock across a flapping channel", async () => {
    const { client } = countingClient();
    const { subscribe } = channel();
    const view = render(
      <Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={90_000} />,
    );
    await elapse(60_000);
    view.rerender(<Harness client={client} signal={{ live: false, subscribe }} maxWaitMs={90_000} />);
    await elapse(0);
    view.rerender(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={90_000} />);

    await elapse(31_000);

    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("true");
  });
});
