// @vitest-environment jsdom
/**
 * FUT-556 — the flows layer's return screen has to stop asking too.
 *
 * `useHostedResume` in the components layer had an unbounded poll and so did
 * this screen, which is the same bug shipped twice. That is the failure mode
 * this package's own docs name: a mechanism each surface has to remember gets
 * remembered by some of them.
 *
 * Driven through the REAL screen the factory builds, against a transport that
 * answers what a store with a pending redirect charge answers — the buyer paid
 * somewhere else, or did not, and no webhook has said which.
 */
import { cleanup, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberHostedOrder } from "../../components/checkout/hosted-return";
import type { CheckoutOrder } from "../../components/checkout/types";
import { createPaymentFlows } from "../create-payment-flows";
import { STORY_CHECKOUT_COPY } from "../../stories/demo-copy";

const ORDER: CheckoutOrder = {
  orderId: "o-hosted",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 4200,
  subtotalCents: 4200,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 42,00",
};

/** The screen's own cap and interval — see `screens-hosted.tsx`. */
const POLL_MS = 5_000;
const POLL_CAP = 180;

/** A store that never confirms: every status read answers AWAITING_PAYMENT. */
function pendingForever(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data: "AWAITING_PAYMENT" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function flowsWith(copy?: { returnTimedOut?: string }) {
  return createPaymentFlows({
    transport: { fetchImpl: pendingForever() },
    useScope: () => ({ tenantSlug: "loja-1" }),
    useCart: () => ({
      empty: false,
      lines: [],
      totalCents: 4200,
      subtotalCents: 4200,
      totalItems: 1,
      totalLabel: "R$ 42,00",
    }),
    useBuyerDefaults: () => ({ buyer: {}, taxIdOnFile: false }),
    useSettlement: () => null,
    copy: { ...STORY_CHECKOUT_COPY, ...copy },
    ports: {
      // Never called: this screen only ever RESUMES a charge raised earlier.
      createPayable: async () => ({
        ok: false as const,
        error: { message: "n/a", code: "UNAVAILABLE", field: null },
      }),
      saveBuyerContact: () => undefined,
      exitToCatalog: () => undefined,
      navigate: () => undefined,
    },
  });
}

describe("the flows return screen", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("stops spinning once the wait elapses", async () => {
    rememberHostedOrder(ORDER);
    const flows = flowsWith();

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * (POLL_CAP + 10));
    });

    expect(screen.getByTestId("checkout-hosted-return-timeout")).toBeTruthy();
    expect(screen.queryAllByTestId("checkout-hosted-return-waiting")).toHaveLength(0);
  });

  it("says the host's sentence when the host wrote one", async () => {
    rememberHostedOrder(ORDER);
    const flows = flowsWith({ returnTimedOut: "Não pague de novo." });

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * (POLL_CAP + 10));
    });

    expect(screen.getByText("Não pague de novo.")).toBeTruthy();
  });

  it("still stops spinning for a host that wrote none", async () => {
    // The bound is the package's; the words are the host's. A host that has not
    // adopted the copy key must still not get the infinite spinner.
    rememberHostedOrder(ORDER);
    const flows = flowsWith();

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * (POLL_CAP + 10));
    });

    expect(screen.getByTestId("checkout-hosted-return-timeout")).toBeTruthy();
  });

  it("is still spinning partway through", async () => {
    rememberHostedOrder(ORDER);
    const flows = flowsWith();

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    });

    expect(screen.getByTestId("checkout-hosted-return-waiting")).toBeTruthy();
    expect(screen.queryAllByTestId("checkout-hosted-return-timeout")).toHaveLength(0);
  });
});
