// @vitest-environment jsdom
/**
 * FUT-1213, FUT-1140 and FUT-1146 — one mechanism, driven end to end.
 *
 * What a shopper actually did: went to the provider's page, did not pay, came
 * back to the store by a route that is not the checkout, emptied their basket,
 * added something else, and pressed "pay". The checkout opened on step 3,
 * "Confirmando seu pagamento", polling the abandoned order for fifteen minutes
 * — no amount, no reference, nothing saying which order this was about — and
 * then told them not to pay again. In stub mode the old order self-confirmed
 * and the host's paid handler closed the cart it pointed at, which by then held
 * the NEW lines, so the basket was wiped.
 *
 * These drive the controller, not the rule underneath it (`hosted-return.test`
 * has that), because what has to hold is where the BUYER ends up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX, ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { PaymentStatus } from "../payment-status";
import { PT_BR_PAYMENT_STATUS_COPY } from "../pt-BR";
import { HOSTED_ORDER_STORAGE_KEY, rememberHostedOrder } from "../hosted-return";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, OrderStatus } from "../types";
import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";
import { act, render, renderHook, screen } from "./test-utils";

const ORDER: CheckoutOrder = {
  orderId: "o1",
  status: "AWAITING_PAYMENT",
  method: "PIX",
  totalCents: 2400,
  subtotalCents: 2400,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 24,00",
};

const RAISED = "line-1x2";
const OTHER = "line-9x1";

interface ClientScript {
  status?: OrderStatus;
  statusFails?: boolean;
  release?: OrderStatus;
}

/** A client that answers a script and counts what it was asked. */
function scriptedClient(script: ClientScript = {}) {
  const tally = { status: 0, released: 0 };
  const client = {
    getStatus: async () => {
      tally.status += 1;
      if (script.statusFails) return { ok: false as const, error: "offline" };
      return { ok: true as const, data: script.status ?? "AWAITING_PAYMENT" };
    },
    releaseCheckout: async () => {
      tally.released += 1;
      return { ok: true as const, data: script.release ?? ("FAILED" as OrderStatus) };
    },
  } as unknown as CheckoutClient;
  return { client, tally };
}

function makePorts(): CheckoutHostPorts {
  return { createOrder: vi.fn(), saveBuyerContact: vi.fn(), onExitToMenu: vi.fn(), onPaid: vi.fn() };
}

function wrapperFor(client: CheckoutClient) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>;
  };
}

/** Let the deferred decision — and any ask it makes — settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const ready = (signature: string | null): { signature: string | null; ready: boolean } => ({
  signature,
  ready: true,
});

describe("a parked hand-off met by the basket in front of the shopper", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("a parked order is dropped when a different basket stands and the order is not paid", async () => {
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client, tally } = scriptedClient({ status: "AWAITING_PAYMENT" });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(OTHER)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    // The shopper gets THEIR checkout, for the basket they are holding.
    expect(result.current.step).toBe("dados");
    expect(result.current.order).toBeNull();
    expect(result.current.finalStatus).toBeNull();
    // Asked exactly once — the decision is a question, not a wait.
    expect(tally.status).toBe(1);
    // …and the entry is gone, so no later mount can resume it either.
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).toBeNull();
  });

  it("a parked order is resumed when the order is PAID", async () => {
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client } = scriptedClient({ status: "PAID" });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(OTHER)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    // A paid order is settled in the host's own row by the webhook, so the
    // status route answers PAID even though the provider itself cannot be
    // asked without the reference only the paid redirect carries.
    expect(result.current.step).toBe("status");
    expect(result.current.order?.orderId).toBe("o1");
    expect(result.current.finalStatus).toBe("PAID");
  });

  it("resumes with no question at all when the basket is unchanged", async () => {
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client, tally } = scriptedClient({ status: "AWAITING_PAYMENT" });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    expect(result.current.step).toBe("status");
    // The poll starts, so the count is the wait's rather than the decision's —
    // what matters is that nothing was asked BEFORE resuming.
    expect(tally.status).toBeGreaterThan(0);
  });

  it("resumes when the basket is empty, which is the paid buyer's normal state", async () => {
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client } = scriptedClient({ status: "PAID" });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(null)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    expect(result.current.step).toBe("status");
  });

  it("decides NOTHING until the host's cart has loaded", async () => {
    // An unseeded cart reads as empty, and empty is the branch that resumes
    // unconditionally — so deciding early is the old behaviour wearing a rule.
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client } = scriptedClient({ status: "AWAITING_PAYMENT" });

    const { result, rerender } = renderHook(
      ({ basket }: { basket: { signature: string | null; ready: boolean } }) =>
        useCheckoutController(makePorts(), undefined, false, undefined, undefined, basket),
      {
        wrapper: wrapperFor(client),
        initialProps: { basket: { signature: null as string | null, ready: false } },
      },
    );
    await settle();

    expect(result.current.step).toBe("dados");
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).not.toBeNull();

    rerender({ basket: ready(RAISED) });
    await settle();

    expect(result.current.step).toBe("status");
  });

  it("decides anyway when the host's cart never loads", async () => {
    // The deferral assumes the cart eventually answers, and a cart FETCH can
    // fail — on exactly the flaky connection a buyer has coming back from their
    // bank app. Waiting forever there is this ticket's bug pointed the other
    // way: the flow renders Dados and a paid buyer's confirmation never lands.
    vi.useFakeTimers();
    try {
      rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
      const { client } = scriptedClient({ status: "PAID" });

      const { result } = renderHook(
        () =>
          useCheckoutController(makePorts(), undefined, false, undefined, undefined, {
            signature: null as string | null,
            ready: false,
          }),
        { wrapper: wrapperFor(client) },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9_000);
      });

      expect(result.current.step).toBe("status");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the entry parked when the ask itself fails", async () => {
    // "We could not reach the server" is not "the order is not paid". The
    // shopper gets their checkout either way, and a later mount can still find
    // the confirmation.
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client } = scriptedClient({ statusFails: true });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(OTHER)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    expect(result.current.step).toBe("dados");
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).not.toBeNull();
  });
});

describe("an order in flight survives a discarded tab (FUT-1140)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("parks every raised order, not only a hand-off", async () => {
    const ports = {
      ...makePorts(),
      createOrder: vi.fn(async () => ({ ok: true as const, data: ORDER })),
    };
    const { client } = scriptedClient();

    const { result } = renderHook(
      () => useCheckoutController(ports, undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await act(async () => {
      await result.current.startPayment("PIX");
    });

    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).toContain("o1");
  });

  it("puts a reloaded shopper back in front of the code they were paying", async () => {
    // The phone discarded the tab while they were in their bank app. Re-showing
    // the same charge is safe — the server reuses it — and the pane's own poll
    // carries them to the confirmation when it settles.
    rememberHostedOrder(ORDER, { basket: RAISED });
    const { client } = scriptedClient();

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    expect(result.current.step).toBe("payment");
    expect(result.current.order?.orderId).toBe("o1");
    // The method comes back with it, so the picker does not ask a shopper to
    // choose how to pay while they are looking at the code they were paying.
    expect(result.current.method).toBe("PIX");
  });

  it("puts them on the confirmation instead once the server has closed the cart", async () => {
    // QR #1 was paid while the tab was gone. The buyer never saw "Pedido
    // confirmado" before this: they met an empty cart and a retry button.
    rememberHostedOrder(ORDER, { basket: RAISED });
    const { client } = scriptedClient({ status: "PAID" });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(null)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    expect(result.current.step).toBe("status");
    expect(result.current.finalStatus).toBe("PAID");
  });

  it("lets a settled order go, so nothing resumes it afterwards", async () => {
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client } = scriptedClient({ status: "PAID" });

    renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await settle();

    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).toBeNull();
  });
});

describe("the buyer says they did not pay (FUT-1146)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  /** Advance the wait, flushing whatever the timers set in motion. */
  async function elapse(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("is not offered while a confirmation is still plausibly landing", async () => {
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client } = scriptedClient();

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await elapse(5_000);

    expect(result.current.resumeRelease).toBeUndefined();
  });

  it("returns the shopper to a usable checkout once the wait has gone quiet", async () => {
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client, tally } = scriptedClient({ release: "FAILED" });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await elapse(31_000);
    expect(result.current.resumeRelease).toBeDefined();

    await act(async () => {
      result.current.resumeRelease?.();
    });

    expect(tally.released).toBe(1);
    expect(result.current.step).toBe("payment");
    expect(result.current.order).toBeNull();
    expect(result.current.finalStatus).toBeNull();
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).toBeNull();
  });

  it("keeps the confirmation when the release finds the payment after all", async () => {
    // The race the whole design turns on: a webhook a second behind the tap.
    // Their word is why we ask; the server's answer is what we act on.
    rememberHostedOrder(ORDER, { basket: RAISED, handoff: true });
    const { client } = scriptedClient({ release: "PAID" });

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await elapse(31_000);
    await act(async () => {
      result.current.resumeRelease?.();
    });

    expect(result.current.step).toBe("status");
    expect(result.current.finalStatus).toBe("PAID");
  });

  it("is never offered to a checkout that resumed nothing", async () => {
    const { client } = scriptedClient();

    const { result } = renderHook(
      () => useCheckoutController(makePorts(), undefined, false, undefined, undefined, ready(RAISED)),
      { wrapper: wrapperFor(client) },
    );
    await elapse(60_000);

    expect(result.current.resumeRelease).toBeUndefined();
  });
});

describe("what the waiting screen offers (FUT-1146)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the way out beside the wait, not instead of it", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onNotPaid={vi.fn()}
      />,
    );

    expect(screen.getByTestId("payment-not-paid")).toBeTruthy();
    // The wait itself is untouched: a shopper whose webhook is one second away
    // must still see it working.
    expect(screen.getByTestId("payment-pending")).toBeTruthy();
  });

  it("stands down while its own request is out, so it cannot be pressed twice", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="AWAITING_PAYMENT"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onNotPaid={vi.fn()}
        releasing
      />,
    );

    expect(screen.queryAllByTestId("payment-not-paid")).toHaveLength(0);
  });

  it("is not on a screen that already has its answer", () => {
    render(
      <PaymentStatus
        copy={PT_BR_PAYMENT_STATUS_COPY}
        status="PAID"
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onNotPaid={vi.fn()}
      />,
    );

    expect(screen.queryAllByTestId("payment-not-paid")).toHaveLength(0);
  });
});
