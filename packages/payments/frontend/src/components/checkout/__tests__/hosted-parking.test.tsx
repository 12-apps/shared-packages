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
import { CheckoutNavigateProvider } from "../navigate-context";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, CreateOrderResult } from "../types";
import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";
import { useWalletCharge } from "../use-wallet-charge";
import { act, renderHook, waitFor } from "./test-utils";

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

const HANDOFF_URL = "https://provider.example/pay/x";

function countingClient(status: "PAID" | "AWAITING_PAYMENT" | "FAILED" = "PAID") {
  const tally = { status: 0 };
  const client = {
    getStatus: async () => {
      tally.status += 1;
      return { ok: true as const, data: status };
    },
    releaseCheckout: async () => ({ ok: true as const, data: "FAILED" as const }),
    chargeWallet: async () => ({ ok: true as const, data: { status: "AWAITING_PAYMENT", hostedCheckoutUrl: HANDOFF_URL } }),
  } as unknown as CheckoutClient;
  return { client, tally };
}

function ports(raised: CheckoutOrder): CheckoutHostPorts {
  const result: CreateOrderResult = { ok: true, data: raised };
  return { createOrder: vi.fn(async () => result), onExitToMenu: vi.fn(), onPaid: vi.fn() };
}

function wrapperFor(client: CheckoutClient, parks: boolean, navigate: (url: string) => void = vi.fn()) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <CheckoutClientProvider client={client}>
        <CheckoutNavigateProvider navigate={navigate}>
          <HostedParkingContext.Provider value={parks}>{children}</HostedParkingContext.Provider>
        </CheckoutNavigateProvider>
      </CheckoutClientProvider>
    );
  };
}

/** The return trip: the host's own checkout route, which parks and resumes as ever. */
async function returnTrip(client: CheckoutClient) {
  const { result } = renderHook(() => useCheckoutController(ports(CHECKOUT_PIX), undefined, "loja"), {
    wrapper: wrapperFor(client, true),
  });
  await settle();
  return result;
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

  it("leaves the checkout's entry in place when a refused raise is retried", async () => {
    rememberHostedOrder(CHECKOUT_PIX, { tenantSlug: "loja" });
    const before = parked();
    const { client } = countingClient();
    const refused: CreateOrderResult = { ok: false, error: { code: "PROVIDER_ERROR", message: "Recusado", field: null } };
    const host = { ...ports(SHEET_PIX), createOrder: vi.fn(async () => refused) };
    const { result } = renderHook(() => useCheckoutController(host, undefined, "loja"), {
      wrapper: wrapperFor(client, false),
    });

    await act(async () => {
      await result.current.startPayment("PIX");
    });
    act(() => result.current.retry());

    expect(result.current.step).toBe("payment");
    expect(parked()).toBe(before);
  });

  it("leaves the checkout's entry in place when its own payment settles by polling", async () => {
    rememberHostedOrder(CHECKOUT_PIX, { tenantSlug: "loja" });
    const before = parked();
    const { client } = countingClient();
    const { result } = renderHook(() => useCheckoutController(ports(SHEET_PIX), undefined, "loja"), {
      wrapper: wrapperFor(client, false),
    });

    await act(async () => {
      await result.current.startPayment("PIX");
    });
    // What the Pix pane does when its poll answers PAID.
    act(() => result.current.handleResolved("PAID"));

    await waitFor(() => expect(result.current.finalStatus).toBe("PAID"));
    expect(parked()).toBe(before);
  });

  it("still parks a provider's redirect, and the host's checkout resumes it on the way back", async () => {
    const navigate = vi.fn();
    const { client } = countingClient();
    const handoff = { ...SHEET_PIX, hostedCheckoutUrl: HANDOFF_URL };
    const { result } = renderHook(() => useCheckoutController(ports(handoff), undefined, "loja"), {
      wrapper: wrapperFor(client, false, navigate),
    });

    await act(async () => {
      await result.current.startPayment("PIX");
    });

    expect(navigate).toHaveBeenCalledWith(HANDOFF_URL);
    expect(JSON.parse(parked() ?? "null")).toMatchObject({ order: { orderId: "pedido-paid-again" }, handoff: true });
    const back = await returnTrip(client);
    expect(back.current.order?.orderId).toBe("pedido-paid-again");
    expect(back.current.step).toBe("status");
  });

  it("still parks a wallet's 3-D Secure hand-off, and the host's checkout resumes it on the way back", async () => {
    const navigate = vi.fn();
    const { client } = countingClient();
    const { result } = renderHook(() => useWalletCharge(SHEET_PIX, {}, vi.fn(), 10, { tenantSlug: "loja" }), {
      wrapper: wrapperFor(client, false, navigate),
    });

    await act(async () => {
      await result.current.payWithKey("GOOGLE_PAY", "token");
    });

    expect(navigate).toHaveBeenCalledWith(HANDOFF_URL);
    expect(JSON.parse(parked() ?? "null")).toMatchObject({ order: { orderId: "pedido-paid-again" }, handoff: true });
    const back = await returnTrip(client);
    expect(back.current.order?.orderId).toBe("pedido-paid-again");
    expect(back.current.step).toBe("status");
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
