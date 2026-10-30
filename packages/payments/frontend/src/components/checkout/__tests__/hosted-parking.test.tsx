// @vitest-environment jsdom
/**
 * A mount that keeps out of the parked-payment slot (`parkHostedOrders={false}`).
 *
 * What a buyer did on the host that asked for it: paid a pedido again from its
 * own page, with the checkout's list in a sheet. The sheet's Pix was parked with
 * no basket, so the NEXT checkout resumed it over a cart nobody had ordered and
 * showed "Pedido confirmado" for the old pedido. The other way round, the
 * sheet's mount took a Pix the checkout had parked, polled that order and
 * closed itself as paid. Neither mount may touch the other's slot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX, ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { HostedParkingContext } from "../hosted-parking";
import { HOSTED_ORDER_STORAGE_KEY, rememberHostedOrder } from "../hosted-return";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, CreateOrderResult } from "../types";
import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";
import { act, renderHook } from "./test-utils";

const CHECKOUT_PIX: CheckoutOrder = {
  orderId: "checkout-order",
  status: "AWAITING_PAYMENT",
  method: "PIX",
  totalCents: 2400,
  subtotalCents: 2400,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 24,00",
};

const SHEET_PIX: CheckoutOrder = { ...CHECKOUT_PIX, orderId: "pedido-paid-again" };

function countingClient() {
  const tally = { status: 0 };
  const client = {
    getStatus: async () => {
      tally.status += 1;
      return { ok: true as const, data: "PAID" as const };
    },
    releaseCheckout: async () => ({ ok: true as const, data: "FAILED" as const }),
  } as unknown as CheckoutClient;
  return { client, tally };
}

function ports(raised: CheckoutOrder): CheckoutHostPorts {
  const result: CreateOrderResult = { ok: true, data: raised };
  return { createOrder: vi.fn(async () => result), onExitToMenu: vi.fn(), onPaid: vi.fn() };
}

function wrapperFor(client: CheckoutClient, parks: boolean) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <CheckoutClientProvider client={client}>
        <HostedParkingContext.Provider value={parks}>{children}</HostedParkingContext.Provider>
      </CheckoutClientProvider>
    );
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const parked = (): string | null => window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY);

describe("a mount that keeps out of the parked-payment slot", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("parks nothing for a Pix it raises, so the next checkout has nothing to resume", async () => {
    const { client } = countingClient();
    const { result } = renderHook(() => useCheckoutController(ports(SHEET_PIX), undefined, "loja"), {
      wrapper: wrapperFor(client, false),
    });

    await act(async () => {
      await result.current.startPayment("PIX");
    });

    expect(result.current.order?.orderId).toBe("pedido-paid-again");
    expect(parked()).toBeNull();
  });

  it("does not resume, ask about or consume the Pix the host's checkout parked", async () => {
    rememberHostedOrder(CHECKOUT_PIX, { tenantSlug: "loja" });
    const before = parked();
    const { client, tally } = countingClient();

    const { result } = renderHook(() => useCheckoutController(ports(SHEET_PIX), undefined, "loja"), {
      wrapper: wrapperFor(client, false),
    });
    await settle();

    expect(result.current.step).toBe("payment");
    expect(result.current.order).toBeNull();
    expect(result.current.finalStatus).toBeNull();
    expect(tally.status).toBe(0);
    expect(parked()).toBe(before);
  });

  it("leaves the checkout's entry in place when it changes method, drops its order or settles", async () => {
    rememberHostedOrder(CHECKOUT_PIX, { tenantSlug: "loja" });
    const before = parked();
    const { client } = countingClient();
    const { result } = renderHook(() => useCheckoutController(ports({ ...SHEET_PIX, status: "PAID" }), undefined, "loja"), {
      wrapper: wrapperFor(client, false),
    });

    act(() => result.current.setMethod("CARD"));
    act(() => result.current.dropOrder());
    await act(async () => {
      await result.current.startPayment("PIX");
    });

    expect(result.current.finalStatus).toBe("PAID");
    expect(parked()).toBe(before);
  });

  it("still parks by default: the host's one checkout keeps its recovery", async () => {
    const { client } = countingClient();
    const { result } = renderHook(() => useCheckoutController(ports(CHECKOUT_PIX), undefined, "loja"), {
      wrapper: wrapperFor(client, true),
    });

    await act(async () => {
      await result.current.startPayment("PIX");
    });

    expect(parked()).toContain("checkout-order");
  });
});
