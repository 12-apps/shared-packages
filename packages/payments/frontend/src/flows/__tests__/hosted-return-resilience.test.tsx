// @vitest-environment jsdom
/**
 * FUT-1144 — the flows layer's return screen, on a connection that is down.
 *
 * `hosted-return-bounded.test.tsx` pins what this screen does when the wait runs
 * OUT. This pins what it does when the wait cannot run at all, which is the case
 * that shipped silent: the poll gave up after four consecutive errors, the
 * screen had nothing to render for that, and the buyer went on reading
 * "Confirmando seu pagamento…" under a spinner that would never move again.
 *
 * Driven through the REAL screen the factory builds, against a transport that
 * behaves exactly like a handset mid-handoff: every request throws.
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

/** The whole wall-clock window this screen asks inside — see `screens-hosted.tsx`. */
const WINDOW_MS = 15 * 60_000;

/** A network that is simply not there: every request throws, as `fetch` does. */
function downForever(): typeof fetch {
  return (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
}

function flowsWith(copy?: { returnCheckAgain?: string | undefined }) {
  return createPaymentFlows({
    transport: { fetchImpl: downForever() },
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

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the flows return screen with no connection", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("says so, instead of spinning as if nothing were wrong", async () => {
    rememberHostedOrder(ORDER);
    const flows = flowsWith();

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await elapse(30_000);

    expect(screen.getByTestId("checkout-hosted-return-unreachable")).toBeTruthy();
    expect(screen.queryAllByTestId("checkout-hosted-return-waiting")).toHaveLength(0);
  });

  it("offers the host's check-again when the host wrote one", async () => {
    rememberHostedOrder(ORDER);
    const flows = flowsWith();

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await elapse(30_000);

    expect(screen.getByTestId("checkout-hosted-return-check-again")).toBeTruthy();
  });

  it("still says something for a host that wrote no label for the action", async () => {
    // The `returnTimedOut` precedent: a bound with no copy still stops the
    // spinner, and an action with no copy stands down rather than being
    // labelled in this package's Portuguese.
    rememberHostedOrder(ORDER);
    const flows = flowsWith({ returnCheckAgain: undefined });

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await elapse(30_000);

    expect(screen.getByTestId("checkout-hosted-return-unreachable")).toBeTruthy();
    expect(screen.queryAllByTestId("checkout-hosted-return-check-again")).toHaveLength(0);
  });

  it("keeps asking across the whole window rather than giving up at four errors", async () => {
    // The bug, at this layer. Four failures is ~10 s; the screen must still be
    // asking a quarter of an hour later, and only then stop.
    rememberHostedOrder(ORDER);
    const flows = flowsWith();

    render(<flows.screens.HostedReturn onResolved={() => undefined} />);
    await elapse(WINDOW_MS - 60_000);
    expect(screen.getByTestId("checkout-hosted-return-unreachable")).toBeTruthy();

    await elapse(120_000);
    // Past the wall clock it reports the elapsed wait — the state that says
    // "do not pay again" — rather than an unreachable poll it is no longer making.
    expect(screen.getByTestId("checkout-hosted-return-timeout")).toBeTruthy();
  });
});
