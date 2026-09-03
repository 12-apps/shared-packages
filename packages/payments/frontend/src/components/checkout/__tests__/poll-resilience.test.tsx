// @vitest-environment jsdom
/**
 * FUT-1144 — a blip must not end the wait, and the wait must end on a clock.
 *
 * The status poll gave up after FOUR consecutive errors and never re-armed. Four
 * errors at 2.5 s is about ten seconds of no signal: a Wi-Fi→4G handoff, or iOS
 * aborting the in-flight fetches while the shopper is in their bank app. So the
 * commonest thing a shopper does on the PIX screen — leave it to go and pay —
 * was itself enough to stop the screen that tells them it worked.
 *
 * The three consequences were one bug wearing three faces: the PIX QR sat under
 * a red "não foi possível confirmar" with no retry, the card spinner was
 * replaced by the same alert with the pay bar already gone, and the hosted
 * return spun forever because its bound counted HEALTHY polls — a counter the
 * failure had frozen.
 *
 * What these pin is that the two halves are now different questions. Errors
 * decide the CADENCE (slower, capped, never terminal); the clock decides the
 * ENDING, and it cannot be stopped by what it is measuring.
 */
import { act, fireEvent, render, renderHook, screen } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX, ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { rememberHostedOrder } from "../hosted-return";
import { PaymentStatus } from "../payment-status";
import { PixView } from "../pix-view";
import { PT_BR_PAYMENT_STATUS_COPY } from "../pt-BR";
import type { CheckoutClient } from "../transport";
import { PT_BR_CHECKOUT_COPY } from "../pt-BR";
import type { CheckoutOrder, OrderStatus } from "../types";
import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";
import { usePaymentPolling } from "../use-payment-polling";
import type { Result } from "../../../result";

const ORDER: CheckoutOrder = {
  orderId: "o1",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 2400,
  subtotalCents: 2400,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 24,00",
};

const PIX_ORDER: CheckoutOrder = {
  ...ORDER,
  method: "PIX",
  pix: { copyPaste: "00020126BR.GOV.BCB.PIX", expiresAt: "2026-09-02T21:00:00.000Z" },
};

/** The sentence a dropped connection actually arrives as. */
const OFFLINE = "Não foi possível conectar. Verifique sua conexão e tente novamente.";
const DOWN: Result<OrderStatus> = { ok: false, error: OFFLINE };
const PENDING: Result<OrderStatus> = { ok: true, data: "AWAITING_PAYMENT" };

/** The card and wallet bound, in wall time. */
const CARD_WAIT_MS = 90_000;

/**
 * A client answering per CALL NUMBER, counting every ask.
 *
 * The tally is a container rather than a closed-over `let`: reassigning a
 * binding from inside a stub is the flakiness gate's `no-global-state-mutation`,
 * and the count here outlives every stub that writes it.
 */
function scriptedClient(answer: (call: number) => Result<OrderStatus>): {
  client: CheckoutClient;
  calls: () => number;
} {
  const tally = { asked: 0 };
  const client = {
    getStatus: async () => {
      tally.asked += 1;
      return answer(tally.asked);
    },
  } as unknown as CheckoutClient;
  return { client, calls: () => tally.asked };
}

/** A client whose answer can be swapped mid-wait, the way a network comes back. */
function switchableClient(): {
  client: CheckoutClient;
  calls: () => number;
  answerWith: (next: Result<OrderStatus>) => void;
} {
  const world = { asked: 0, answer: DOWN as Result<OrderStatus> };
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

function withClient(client: CheckoutClient) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>;
  };
}

function makePorts(): CheckoutHostPorts {
  return { createOrder: vi.fn(), saveBuyerContact: vi.fn(), onExitToMenu: vi.fn(), onPaid: vi.fn() };
}

/** Drive the wait, including the immediate first poll on mount. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Deliver a browser event and let whatever it started settle. */
async function fire(target: EventTarget, type: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new Event(type));
    await vi.advanceTimersByTimeAsync(0);
  });
}

function useWait(client: CheckoutClient, options: Parameters<typeof usePaymentPolling>[1]) {
  return renderHook(() => usePaymentPolling("o1", options), { wrapper: withClient(client) });
}

/** A client whose ask NEVER resolves — the dead socket, not the 500. */
function hangingClient(): { client: CheckoutClient; calls: () => number } {
  const tally = { asked: 0 };
  const client = {
    getStatus: () => {
      tally.asked += 1;
      return new Promise<Result<OrderStatus>>(() => {});
    },
  } as unknown as CheckoutClient;
  return { client, calls: () => tally.asked };
}

/** A client whose ask REJECTS — a host wrapper that rethrows, not a 500. */
function throwingClient(): { client: CheckoutClient; calls: () => number } {
  const tally = { asked: 0 };
  const client = {
    getStatus: () => {
      tally.asked += 1;
      return Promise.reject(new Error("interceptor exploded"));
    },
  } as unknown as CheckoutClient;
  return { client, calls: () => tally.asked };
}

/**
 * Attempt 1 is held open and answered by hand; every later ask hangs. No timer
 * decides when the answer lands, so the interleaving under test is exact.
 */
function heldThenHangingClient(): {
  client: CheckoutClient;
  answer: (result: Result<OrderStatus>) => void;
} {
  // One object rather than a reassigned binding: the flakiness lane reads a
  // closed-over `let` written from inside a stub as shared state, and it is
  // right to — a field on a per-call object cannot outlive this factory.
  const state: { asked: number; release?: (result: Result<OrderStatus>) => void } = { asked: 0 };
  const client = {
    getStatus: () => {
      state.asked += 1;
      if (state.asked > 1) return new Promise<Result<OrderStatus>>(() => {});
      return new Promise<Result<OrderStatus>>((resolve) => {
        state.release = resolve;
      });
    },
  } as unknown as CheckoutClient;
  return { client, answer: (result) => state.release?.(result) };
}

describe("an ask that never comes back", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps polling instead of wedging on the first hang", async () => {
    // The shape the ticket's own fix could not survive: `inFlight` gated the
    // tick, so ONE request that never resolved stopped the wait for good —
    // silently, with the spinner still turning.
    const { client, calls } = hangingClient();
    useWait(client, { askTimeoutMs: 5_000 });

    await elapse(60_000);

    expect(calls()).toBeGreaterThan(1);
  });

  it("still times out on the wall clock while an ask is hung", async () => {
    // `outOfTime` is only consulted once an ask RETURNS, so a hang used to run
    // straight past the deadline: the one leg the ticket describes as spinning
    // forever, spinning forever again for a different reason.
    const { client } = hangingClient();
    const { result } = useWait(client, { askTimeoutMs: 5_000, maxWaitMs: 20_000 });

    await elapse(60_000);

    expect(result.current.timedOut).toBe(true);
  });

  it("sends a new request when the buyer presses check-again mid-hang", async () => {
    // `restart` cleared the panel and returned without asking, because `tick`
    // refused while `inFlight`. The buyer pressed a button that did nothing and
    // was shown a screen saying everything was fine.
    const { client, calls } = hangingClient();
    const { result } = useWait(client, { askTimeoutMs: 60_000 });
    await elapse(0);
    const before = calls();

    await act(async () => {
      result.current.checkAgain();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls()).toBe(before + 1);
  });

  it("times out even while the shopper keeps re-arming it", async () => {
    // The hole the first pass left, and the sharpest one: `askTimeout` stands
    // down when its attempt is superseded, and every `poke` supersedes. A
    // shopper flicking to their bank app more often than `askTimeoutMs` — which
    // is EXACTLY the behaviour this feature was built for — therefore refreshed
    // the timeout forever, so no ask ever returned, `outOfTime` was never
    // reached, and the hosted return span with no error and so no check-again
    // button. The ticket's own symptom, back through the door the fix opened.
    const { client } = hangingClient();
    const { result } = useWait(client, { askTimeoutMs: 15_000, maxWaitMs: 20_000 });

    for (let trip = 0; trip < 12; trip += 1) {
      await elapse(10_000);
      await fire(window, "online");
    }

    expect(result.current.timedOut).toBe(true);
  });

  it("reads as a dropped connection, not as the word `timeout`", async () => {
    // `Result.error` is what the BUYER reads — the PIX, card and wallet panels
    // all render it verbatim — so an abandoned ask must carry the transport's
    // own sentence rather than an English debug token in a pt-BR panel.
    const { client } = hangingClient();
    const { result } = useWait(client, { askTimeoutMs: 5_000 });

    await elapse(6_000);

    expect(result.current.error).toBe(PT_BR_CHECKOUT_COPY.screens.transport.offline);
    expect(result.current.error).not.toBe("timeout");
  });

  it("re-arms on `online` mid-hang — the handoff this feature exists for", async () => {
    // A Wi-Fi to 4G handoff leaves the previous fetch on a socket that will
    // never answer. That is precisely when `poke` must not be refused.
    const { client, calls } = hangingClient();
    useWait(client, { askTimeoutMs: 60_000 });
    await elapse(2_000);
    const before = calls();

    await fire(window, "online");

    expect(calls()).toBe(before + 1);
  });

  it("keeps polling when the ask REJECTS rather than hangs", async () => {
    // `Promise.race` rejects the moment either input does, so the timeout gives
    // no cover here: the await threw, `inFlight` was never cleared, no timer
    // was scheduled, and the loop was dead with nothing on screen. Our own
    // transport catches its errors, but `CheckoutClient` is the public host
    // seam — an auth-refresh wrapper that rethrows wedged the wait for good.
    const { client, calls } = throwingClient();
    useWait(client, { askTimeoutMs: 60_000 });

    await elapse(30_000);

    expect(calls()).toBeGreaterThan(1);
  });

  it("keeps a terminal answer that a re-arm superseded", async () => {
    // Dropping every superseded answer drops PAID with them. The status is
    // idempotent and `settled` only goes one way, so the confirmation the whole
    // wait exists for must be written whenever it arrives — otherwise a shopper
    // who paid is told nothing, and if the next ask hangs, never told at all.
    const { client, answer } = heldThenHangingClient();
    const { result } = useWait(client, { askTimeoutMs: 60_000 });

    await elapse(2_000);
    await fire(window, "online");
    await act(async () => {
      answer({ ok: true, data: "PAID" });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe("PAID");
  });
});

describe("a run of failed polls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not stop after four — or after twenty", async () => {
    // THE BUG, stated as a count. Four consecutive errors was terminal, and four
    // is what ten seconds of no signal produces at the default rate.
    const { client, calls } = scriptedClient(() => DOWN);
    const { result } = useWait(client, { intervalMs: 2500 });

    await elapse(60_000);

    // 0s, 2.5s, 7.5s, then every 10s: eight asks where the old code made four
    // and then went quiet forever.
    expect(calls()).toBe(8);
    expect(result.current.error).toBe(OFFLINE);
    expect(result.current.timedOut).toBe(false);
  });

  it("backs off 2.5s → 5s → 10s, and no further", async () => {
    // Unbounded doubling would be the same bug with a slower fuse: by the tenth
    // failure the next ask would be a fortnight away.
    const { client, calls } = scriptedClient(() => DOWN);
    useWait(client, { intervalMs: 2500 });

    await elapse(2_499);
    expect(calls()).toBe(1);
    await elapse(1); // 2.5s — the first backoff is still the healthy cadence
    expect(calls()).toBe(2);
    await elapse(4_999);
    expect(calls()).toBe(2);
    await elapse(1); // 7.5s — doubled to 5s
    expect(calls()).toBe(3);
    await elapse(9_999);
    expect(calls()).toBe(3);
    await elapse(1); // 17.5s — doubled again, to the 10s cap
    expect(calls()).toBe(4);

    // And it stays there: a full further minute is exactly six more asks.
    const atCap = calls();
    await elapse(60_000);
    expect(calls() - atCap).toBe(6);
  });

  it("never asks faster than the healthy cadence it is backing off from", async () => {
    // A consumer whose slow phase is 10s must not have a FAILING poll drop back
    // to 2.5s the moment the error count laps the cap.
    const { client, calls } = scriptedClient((call) => (call <= 3 ? PENDING : DOWN));
    useWait(client, { intervalMs: 2500, slowAfterPolls: 3, slowIntervalMs: 10_000 });

    await elapse(5_000); // three healthy asks at 2.5s: 0s, 2.5s, 5s
    expect(calls()).toBe(3);
    await elapse(60_000); // the slow phase, now failing: six asks, not twenty-four
    expect(calls()).toBe(9);
  });
});

describe("a poll that succeeds again", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears the error and restores the normal cadence", async () => {
    // The recovery the old code could not perform at all. The error state has to
    // be transient or the screen keeps a red panel over a wait that is working.
    const { client, calls } = scriptedClient((call) => (call <= 3 ? DOWN : PENDING));
    const { result } = useWait(client, { intervalMs: 2500 });

    await elapse(10_000);
    expect(result.current.error).toBe(OFFLINE);

    await elapse(7_500); // the fourth ask, at 17.5s, lands
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("AWAITING_PAYMENT");

    const recovered = calls();
    await elapse(10_000);
    // Back to 2.5s: four asks in ten seconds, not one.
    expect(calls() - recovered).toBe(4);
  });

  it("still settles the order it was asking about", async () => {
    const { client } = scriptedClient((call) => (call <= 5 ? DOWN : { ok: true, data: "PAID" }));
    const { result } = useWait(client, { intervalMs: 2500 });

    await elapse(60_000);

    expect(result.current.status).toBe("PAID");
    expect(result.current.error).toBeNull();
  });
});

describe("the moments a shopper comes back", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks again as soon as the tab becomes visible", async () => {
    // The bank-app trip, which is the whole journey this screen exists for: the
    // shopper leaves to pay, iOS aborts our in-flight fetches, and the answer
    // they are waiting for is ready the instant they come back.
    const wait = switchableClient();
    const { result } = useWait(wait.client, { intervalMs: 2500 });

    await elapse(20_000); // 0s, 2.5s, 7.5s, 17.5s — next not due until 27.5s
    expect(wait.calls()).toBe(4);

    wait.answerWith({ ok: true, data: "PAID" });
    await fire(document, "visibilitychange");

    expect(wait.calls()).toBe(5);
    expect(result.current.status).toBe("PAID");
  });

  it("asks again as soon as the connection returns", async () => {
    const wait = switchableClient();
    const { result } = useWait(wait.client, { intervalMs: 2500 });

    await elapse(20_000);
    expect(wait.calls()).toBe(4);

    wait.answerWith({ ok: true, data: "PAID" });
    await fire(window, "online");

    // Told at once, rather than seven seconds later when the backoff expired.
    expect(wait.calls()).toBe(5);
    expect(result.current.status).toBe("PAID");
    expect(result.current.error).toBeNull();
  });

  it("collapses the burst a returning tab fires", async () => {
    // iOS delivers `visibilitychange` and `online` together on the same trip,
    // and a shopper flicking back and forth delivers them again per trip.
    const { client, calls } = scriptedClient(() => DOWN);
    useWait(client, { intervalMs: 2500 });

    await elapse(20_000);
    const before = calls();

    await fire(window, "online");
    await fire(document, "visibilitychange");
    await fire(window, "online");

    expect(calls() - before).toBe(1);
  });

  it("stops listening once the wait is torn down", async () => {
    // A listener outliving its wait is a request against an order this tree no
    // longer shows — and a state update on an unmounted component.
    const { client, calls } = scriptedClient(() => DOWN);
    const { unmount } = useWait(client, { intervalMs: 2500 });

    await elapse(20_000);
    const before = calls();
    unmount();

    await fire(window, "online");
    await elapse(60_000);

    expect(calls()).toBe(before);
  });
});

describe("what ends the wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is the clock, even when every single poll has failed", async () => {
    // The hosted-return bug in one assertion. A bound counted in HEALTHY polls
    // never advances here, so this wait had no end at all.
    const { client, calls } = scriptedClient(() => DOWN);
    const { result } = useWait(client, { intervalMs: 2500, maxWaitMs: CARD_WAIT_MS });

    await elapse(CARD_WAIT_MS * 3);

    expect(result.current.timedOut).toBe(true);
    expect(result.current.error).toBe(OFFLINE);
    // 0s, 2.5s, 7.5s, then every 10s to 87.5s — eleven asks, then the clock.
    expect(calls()).toBe(11);
  });

  it("is the same clock when every poll is healthy", async () => {
    const { client, calls } = scriptedClient(() => PENDING);
    const { result } = useWait(client, { intervalMs: 2500, maxWaitMs: CARD_WAIT_MS });

    await elapse(CARD_WAIT_MS * 3);

    expect(result.current.timedOut).toBe(true);
    expect(calls()).toBe(36);
  });

  it("does not fire early for a wait that is merely slow", async () => {
    const { client } = scriptedClient(() => DOWN);
    const { result } = useWait(client, { intervalMs: 2500, maxWaitMs: CARD_WAIT_MS });

    await elapse(CARD_WAIT_MS - 10_000);

    expect(result.current.timedOut).toBe(false);
  });

  it("never fires for a consumer that asked for no bound", async () => {
    // PIX passes none: its charge expires server-side and comes back terminal.
    const { client, calls } = scriptedClient(() => DOWN);
    const { result } = useWait(client, { intervalMs: 2500 });

    await elapse(30 * 60_000);

    expect(result.current.timedOut).toBe(false);
    expect(calls()).toBeGreaterThan(100);
  });

  it("is restarted by the buyer's own check-again", async () => {
    const wait = switchableClient();
    const { result } = useWait(wait.client, { intervalMs: 2500, maxWaitMs: CARD_WAIT_MS });

    await elapse(CARD_WAIT_MS * 2);
    expect(result.current.timedOut).toBe(true);

    wait.answerWith({ ok: true, data: "PAID" });
    await act(async () => {
      result.current.checkAgain();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.timedOut).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("PAID");
  });
});

describe("the resumed hosted return", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("says WHY it is still asking, instead of spinning silently", async () => {
    // `useHostedResume` returned status and timedOut and dropped the error, so
    // this leg — the only one with no PIX or card view of its own — reported a
    // dead connection as an ordinary wait.
    rememberHostedOrder(ORDER, { handoff: true });
    const { client } = scriptedClient(() => DOWN);
    const { result } = renderHook(() => useCheckoutController(makePorts()), {
      wrapper: withClient(client),
    });

    await elapse(30_000);

    expect(result.current.resumeError).toBe(OFFLINE);
    expect(result.current.resumeTimedOut).toBe(false);
  });

  it("hands the buyer a way to ask again, and it works", async () => {
    rememberHostedOrder(ORDER, { handoff: true });
    const wait = switchableClient();
    const { result } = renderHook(() => useCheckoutController(makePorts()), {
      wrapper: withClient(wait.client),
    });

    await elapse(30_000);
    expect(result.current.resumeError).toBe(OFFLINE);

    wait.answerWith({ ok: true, data: "PAID" });
    await act(async () => {
      result.current.resumeCheckAgain();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.resumeError).toBeNull();
    expect(result.current.finalStatus).toBe("PAID");
  });

  it("times out on the clock rather than on a counter the failure froze", async () => {
    rememberHostedOrder(ORDER, { handoff: true });
    const { client } = scriptedClient(() => DOWN);
    const { result } = renderHook(() => useCheckoutController(makePorts()), {
      wrapper: withClient(client),
    });

    await elapse(16 * 60_000);

    expect(result.current.resumeTimedOut).toBe(true);
    // Never restated as failed. Nothing was ever learned about this order — no
    // poll got an answer — and "we could not ask" is not "you did not pay": the
    // reconciliation sweep is what rescues a genuinely late webhook, and it does
    // that with the tab closed.
    expect(result.current.finalStatus).toBeNull();
  });
});

describe("what the buyer can press", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers a check-again on the resumed screen, and says it is still trying", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        awaitingError={OFFLINE}
        onCheckAgain={vi.fn()}
      />,
    );

    expect(screen.getByTestId("payment-awaiting-unreachable")).toBeTruthy();
    expect(screen.getByTestId("payment-check-again")).toBeTruthy();
    // The spinner is gone: it cannot honestly stand for progress here.
    expect(screen.queryAllByTestId("payment-pending")).toHaveLength(0);
    // And the instruction that keeps money from moving twice survives.
    expect(screen.getByText(/não pague de novo/i)).toBeTruthy();
  });

  it("wires that button to the wait", () => {
    const onCheckAgain = vi.fn();
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        awaitingTimedOut
        onCheckAgain={onCheckAgain}
      />,
    );

    fireEvent.click(screen.getByTestId("payment-check-again"));

    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it("says it has STOPPED, not that it keeps trying, once the clock has run out", () => {
    // A wait that failed its way to the wall clock carries both flags. The
    // elapsed state has to win: it is the true one, and it is the one whose
    // sentence says not to pay again.
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        awaitingTimedOut
        awaitingError={OFFLINE}
        onCheckAgain={vi.fn()}
      />,
    );

    expect(screen.getByTestId("payment-awaiting-timeout")).toBeTruthy();
    expect(screen.queryAllByTestId("payment-awaiting-unreachable")).toHaveLength(0);
    expect(screen.getByTestId("payment-check-again")).toBeTruthy();
  });

  it("offers nothing extra while the wait is visibly working", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onCheckAgain={vi.fn()}
      />,
    );

    expect(screen.getByTestId("payment-pending")).toBeTruthy();
    expect(screen.queryAllByTestId("payment-check-again")).toHaveLength(0);
  });
});

describe("the PIX screen through a blip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the QR and the code, and offers a check-again", async () => {
    // The QR is what the shopper is mid-way through paying with. A poll failure
    // is about US, not about the charge, and must cost them nothing.
    const { client } = scriptedClient(() => DOWN);
    render(<PixView order={PIX_ORDER} onResolved={vi.fn()} />, { wrapper: withClient(client) });

    await elapse(20_000);

    expect(screen.getByTestId("pix-qr")).toBeTruthy();
    expect(screen.getByTestId("pix-code")).toBeTruthy();
    expect(screen.getByTestId("pix-poll-error")).toBeTruthy();
    expect(screen.getByTestId("pix-check-again")).toBeTruthy();
  });

  it("goes back to the quiet pending indicator once a poll lands", async () => {
    const { client } = scriptedClient((call) => (call <= 3 ? DOWN : PENDING));
    render(<PixView order={PIX_ORDER} onResolved={vi.fn()} />, { wrapper: withClient(client) });

    await elapse(10_000);
    expect(screen.getByTestId("pix-poll-error")).toBeTruthy();

    await elapse(10_000);
    expect(screen.getByTestId("pix-awaiting")).toBeTruthy();
    expect(screen.queryAllByTestId("pix-poll-error")).toHaveLength(0);
  });
});
