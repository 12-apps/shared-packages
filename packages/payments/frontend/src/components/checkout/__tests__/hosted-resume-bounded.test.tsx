// @vitest-environment jsdom
/**
 * FUT-556 — the resumed hosted return has to stop asking eventually.
 *
 * This was the one unbounded wait left in checkout. Card caps its healthy polls
 * at 90 s and wallet caps its own; the redirect return capped nothing, so a
 * buyer who came back from a payment they never completed got "Confirmando seu
 * pagamento — isso costuma levar alguns segundos" and a spinner that was still
 * spinning an hour later.
 *
 * It could not self-correct, either, because the ORDER has no terminal state to
 * arrive at: expiry is PIX-only (it needs a `pixExpiresAt`), and a redirect
 * charge has no QR window to lapse. Nothing was ever going to move that screen.
 *
 * What these pin is the pair of properties that makes the bound safe rather
 * than merely finite: it must not fire while an answer is still coming, and
 * when it does fire the order must be left exactly as it was — still pending,
 * still reconcilable, never restated as failed.
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX, ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { rememberHostedOrder } from "../hosted-return";
import { PaymentStatus } from "../payment-status";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, OrderStatus } from "../types";
import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";

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

/** The cap and interval the controller polls a resumed return on. */
const POLL_MS = 5_000;
const POLL_CAP = 180;

/**
 * A client that answers a scripted sequence of statuses and counts the asking.
 *
 * The count is what "stopped polling" is read off — a `timedOut` flag that
 * flipped while requests kept going would be a label, not a bound.
 */
function scriptedClient(answers: () => OrderStatus): {
  client: CheckoutClient;
  calls: () => number;
} {
  // A container rather than a closed-over `let`: a stub that reassigns a
  // binding outside itself is the flakiness gate's `no-global-state-mutation`,
  // and the reason for the rule is that the binding outlives the stub.
  const tally = { asked: 0 };
  const client = {
    getStatus: async () => {
      tally.asked += 1;
      return { ok: true as const, data: answers() };
    },
  } as unknown as CheckoutClient;
  return { client, calls: () => tally.asked };
}

function makePorts(): CheckoutHostPorts {
  return { createOrder: vi.fn(), saveBuyerContact: vi.fn(), onExitToMenu: vi.fn(), onPaid: vi.fn() };
}

/** Drive the whole wait, including the immediate first poll on mount. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the resumed hosted return stops asking", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("gives up once the wait elapses, instead of spinning forever", async () => {
    rememberHostedOrder(ORDER);
    const { client, calls } = scriptedClient(() => "AWAITING_PAYMENT");
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>
    );

    const { result } = renderHook(() => useCheckoutController(makePorts()), { wrapper });
    await elapse(POLL_MS * (POLL_CAP + 10));

    expect(result.current.resumeTimedOut).toBe(true);
    expect(calls()).toBe(POLL_CAP);
  });

  it("leaves the order pending — the wait ran out, the payment did not fail", async () => {
    // The distinction the whole design turns on. A charge nobody settled inside
    // the window may still settle: the scheduled reconciliation keeps asking the
    // provider for hours after this tab is gone. Restating it as FAILED here
    // would tell a buyer who HAS paid that they have not.
    rememberHostedOrder(ORDER);
    const { client } = scriptedClient(() => "AWAITING_PAYMENT");
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>
    );

    const { result } = renderHook(() => useCheckoutController(makePorts()), { wrapper });
    await elapse(POLL_MS * (POLL_CAP + 10));

    expect(result.current.finalStatus).toBe("AWAITING_PAYMENT");
  });

  it("keeps asking right up to the bound", async () => {
    // A cap that fired early would be the same bug with a shorter fuse: the
    // commonest reason this screen is open is a payment that IS being confirmed.
    rememberHostedOrder(ORDER);
    const { client, calls } = scriptedClient(() => "AWAITING_PAYMENT");
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>
    );

    const { result } = renderHook(() => useCheckoutController(makePorts()), { wrapper });
    await elapse(POLL_MS * (POLL_CAP - 2));

    expect(result.current.resumeTimedOut).toBe(false);
    expect(calls()).toBeGreaterThan(POLL_CAP - 5);
  });

  it("confirms a payment that lands inside the window", async () => {
    rememberHostedOrder(ORDER);
    const seen = { polls: 0 };
    const { client } = scriptedClient(() => {
      seen.polls += 1;
      return seen.polls >= 3 ? "PAID" : "AWAITING_PAYMENT";
    });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>
    );

    const { result } = renderHook(() => useCheckoutController(makePorts()), { wrapper });
    await elapse(POLL_MS * 5);

    expect(result.current.finalStatus).toBe("PAID");
    expect(result.current.resumeTimedOut).toBe(false);
  });

  it("never starts the wait for a buyer who did not come back from anywhere", async () => {
    // Nothing parked ⇒ no resume ⇒ the flag must stay false forever, or a plain
    // checkout would eventually claim a hand-off that never happened.
    const { client, calls } = scriptedClient(() => "AWAITING_PAYMENT");
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>
    );

    const { result } = renderHook(() => useCheckoutController(makePorts()), { wrapper });
    await elapse(POLL_MS * (POLL_CAP + 10));

    expect(result.current.resumeTimedOut).toBe(false);
    expect(calls()).toBe(0);
  });
});

describe("what the buyer reads once it has given up", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says nothing has arrived yet, and drops the spinner", () => {
    render(
      <PaymentStatus
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        awaitingTimedOut
      />,
    );

    expect(screen.getByTestId("payment-awaiting-timeout")).toBeTruthy();
    expect(screen.queryAllByTestId("payment-pending")).toHaveLength(0);
    // The one instruction that matters on this screen.
    expect(screen.getByText(/não pague de novo/i)).toBeTruthy();
  });

  it("still offers the way out it always did", () => {
    render(
      <PaymentStatus
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        awaitingTimedOut
      />,
    );

    expect(screen.getByTestId("payment-back-to-menu")).toBeTruthy();
  });

  it("spins as before while the wait is still running", () => {
    render(<PaymentStatus status="AWAITING_PAYMENT" totalLabel="R$ 24,00" onBackToMenu={vi.fn()} />);

    expect(screen.getByTestId("payment-pending")).toBeTruthy();
    expect(screen.queryAllByTestId("payment-awaiting-timeout")).toHaveLength(0);
  });

  it("ignores the flag on a settled order, which has already resolved", () => {
    render(
      <PaymentStatus status="PAID" totalLabel="R$ 24,00" onBackToMenu={vi.fn()} awaitingTimedOut />,
    );

    expect(screen.getByTestId("payment-paid")).toBeTruthy();
    expect(screen.queryAllByTestId("payment-awaiting-timeout")).toHaveLength(0);
  });
});
