// @vitest-environment jsdom
/**
 * FUT-1145 — card declines are classified server-side and then discarded.
 *
 * Expired card, insufficient funds, card reported stolen, "attempts exhausted
 * — DO NOT RETRY" (10001) and a cancelled recurring mandate (20118) all
 * rendered "Pagamento não concluído / Nenhum valor foi cobrado. Você pode
 * tentar novamente." — and pressing that button minted a NEW order, preselected
 * the same saved card, and left another "Pagamento não realizado" row in the
 * buyer's purchases.
 *
 * These pin the three halves of the fix that live in this package: the sentence
 * a reason produces, the retry a terminal refusal must not offer, and the order
 * a retriable one must not replace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeclineReason } from "@12-apps/payments-backend";

import type { CheckoutDeclineReason } from "../decline";
import { PaymentStatus } from "../payment-status";
import { PT_BR_PAYMENT_STATUS_COPY } from "../pt-BR";
import { EN_US_PAYMENT_STATUS_COPY } from "../en-US";
import type { CheckoutOrder } from "../types";
import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";
import { act, render, renderHook, screen } from "./test-utils";

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

function makePorts(): CheckoutHostPorts {
  return {
    createOrder: vi.fn(async () => ({ ok: true as const, data: ORDER })),
    onExitToMenu: vi.fn(),
  };
}

/**
 * The frontend's reason union is a MIRROR of the backend's, and a mirror that
 * has drifted is worse than no mirror: a reason the server can send and this
 * bundle cannot name is a screen with no sentence for it.
 *
 * A type-level assertion in both directions, so ADDING a reason on either side
 * fails here rather than at a buyer's phone.
 */
type Mirrors = CheckoutDeclineReason extends DeclineReason
  ? DeclineReason extends CheckoutDeclineReason
    ? true
    : false
  : false;
const MIRRORED: Mirrors = true;

// A raised order is parked now (FUT-1140), and these tests share one jsdom
// tab — so without this, one test's checkout resumes the previous one's order.
beforeEach(() => window.sessionStorage.clear());

describe("what a refused card says", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mirrors the backend's reason vocabulary exactly", () => {
    expect(MIRRORED).toBe(true);
  });

  it("names the expired card rather than refusing in general", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="FAILED"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        decline={{ reason: "EXPIRED_CARD", retriable: false }}
      />,
    );

    expect(screen.getByText(PT_BR_PAYMENT_STATUS_COPY.declined.EXPIRED_CARD!.heading)).toBeTruthy();
  });

  it("says the same thing in the other language, from the same reason", () => {
    render(
      <PaymentStatus
        copy={EN_US_PAYMENT_STATUS_COPY}
        status="FAILED"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        decline={{ reason: "INSUFFICIENT_FUNDS" }}
      />,
    );

    expect(
      screen.getByText(EN_US_PAYMENT_STATUS_COPY.declined.INSUFFICIENT_FUNDS!.heading),
    ).toBeTruthy();
  });

  it("falls back to the generic refusal for a reason nobody wrote a sentence for", () => {
    // A newer server, or a host mid-migration. The fallback is exactly the
    // screen this ticket started from, so the worst case is no worse than
    // before — never a blank heading.
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="FAILED"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        decline={{ reason: "UNKNOWN" }}
      />,
    );

    expect(screen.getByText(PT_BR_PAYMENT_STATUS_COPY.failed.heading)).toBeTruthy();
  });

  it("says what it always said when the server sent no classification", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="FAILED"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
      />,
    );

    expect(screen.getByText(PT_BR_PAYMENT_STATUS_COPY.failed.heading)).toBeTruthy();
  });
});

describe("the retry a refusal is allowed to offer", () => {
  it("withholds it when the provider says another attempt cannot work", () => {
    // 10001 (attempts exhausted) and 20118 (a cancelled recurring mandate) are
    // the rows this exists for. A button that mints a second identical decline
    // is worse than useless on a card the issuer is already counting.
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="FAILED"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onRetry={vi.fn()}
        decline={{ reason: "CARD_DECLINED", retriable: false }}
      />,
    );

    expect(screen.queryAllByTestId("payment-retry")).toHaveLength(0);
    // …and the way out is still there.
    expect(screen.getByTestId("payment-back-to-menu")).toBeTruthy();
  });

  it("offers it when the provider says another attempt could", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="FAILED"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onRetry={vi.fn()}
        decline={{ reason: "INSUFFICIENT_FUNDS", retriable: true }}
      />,
    );

    expect(screen.getByTestId("payment-retry")).toBeTruthy();
  });

  it("offers it when the provider said nothing — silence is not a refusal to retry", () => {
    // Withholding the button on silence would strand a buyer whose card is
    // fine, which is a worse failure than one wasted attempt.
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="FAILED"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId("payment-retry")).toBeTruthy();
  });
});

describe("what a retry does to the order", () => {
  it("keeps the SAME order when the refusal says another instrument could work", async () => {
    const { result } = renderHook(() => useCheckoutController(makePorts()));
    await act(async () => {
      await result.current.startPayment("CARD");
    });
    act(() => {
      result.current.handleResolved("FAILED", { reason: "INSUFFICIENT_FUNDS", retriable: true });
    });
    act(() => {
      result.current.retry();
    });

    // One order for one purchase. Minting another leaves a trail of failed
    // orders in the buyer's own history for a payment they are still making.
    expect(result.current.order?.orderId).toBe("o1");
    expect(result.current.step).toBe("payment");
    // …and the card that failed is not chosen for them again.
    expect(result.current.freshInstrument).toBe(true);
  });

  it("raises a fresh one when the refusal was terminal", async () => {
    const { result } = renderHook(() => useCheckoutController(makePorts()));
    await act(async () => {
      await result.current.startPayment("CARD");
    });
    act(() => {
      result.current.handleResolved("FAILED", { reason: "CARD_DECLINED", retriable: false });
    });
    act(() => {
      result.current.retry();
    });

    expect(result.current.order).toBeNull();
  });

  it("raises a fresh one when nothing was said, exactly as it always did", async () => {
    const { result } = renderHook(() => useCheckoutController(makePorts()));
    await act(async () => {
      await result.current.startPayment("CARD");
    });
    act(() => {
      result.current.handleResolved("FAILED");
    });
    act(() => {
      result.current.retry();
    });

    expect(result.current.order).toBeNull();
  });
});
