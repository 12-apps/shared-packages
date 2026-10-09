// @vitest-environment jsdom
/**
 * FUT-1139 — the checkout must not charge a cart it never re-reads.
 *
 * An order is raised the moment the buyer picks a method, priced on the cart
 * as it stood then. When the cart moves under it — another tab adds a line —
 * the PIX code or the card's pay bar still asks for the OLD amount, and paying
 * it settles an order that no longer describes what the buyer is buying. The
 * screen now notices (the host's basket signature, `./basket.ts`), says so,
 * and offers the one control that re-prices the payment; a card the host
 * refuses with `CART_CHANGED` re-reads its order on its own.
 */
import { useState, type JSX, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CART_CHANGED_CODE,
  CartChangedBoundary,
  PaymentRefreshProvider,
  paymentRefresh,
  useBasketChanged,
  useOrderRefresh,
  useRefreshOnCartChanged,
} from "../cart-changed";
import { CheckoutClientProvider } from "../client-context";
import { CheckoutFlow } from "../checkout-flow";
import { PaymentStep } from "../checkout-steps";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, CreateOrderResult, OrderStatus } from "../types";
import type { Result } from "../../../result";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "./test-utils";

/** Far enough out that a real-timer run never meets an expired code. */
const EXPIRES_AT = "2099-01-01T00:00:00.000Z";
const AWAITING: Result<OrderStatus> = { ok: true, data: "AWAITING_PAYMENT" };

function order(id: string, method: "PIX" | "CARD", totalCents: number): CheckoutOrder {
  return {
    orderId: id,
    status: "AWAITING_PAYMENT",
    method,
    totalCents,
    subtotalCents: totalCents,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: `R$ ${(totalCents / 100).toFixed(2).replace(".", ",")}`,
    ...(method === "PIX"
      ? { pix: { copyPaste: `00020126BR.GOV.BCB.PIX.${id}.${totalCents}`, expiresAt: EXPIRES_AT } }
      : {}),
  };
}

const CLIENT = { getStatus: async () => AWAITING } as unknown as CheckoutClient;

function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <CheckoutClientProvider client={CLIENT}>{children}</CheckoutClientProvider>;
}


beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

// REAL timers here: the absences below are asserted through `waitFor`, which
// cannot advance a faked clock.
describe("a PIX code raised from a basket the buyer has since changed (FUT-1139)", () => {
  function flow(signature: string, createOrder: () => Promise<CreateOrderResult>): JSX.Element {
    return (
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 6,90", totalItems: 1, identity: { signature, ready: true } }}
        createOrder={createOrder}
        onExitToMenu={vi.fn()}
        taxIdOnFile
      />
    );
  }

  it("says so, and mints a code for the cart as it stands", async () => {
    const raised = [order("o1", "PIX", 690), order("o1", "PIX", 2070)];
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: true, data: raised.shift()! }));
    const { rerender } = render(flow("l1x1", createOrder), { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId("checkout-method-PIX"));
    await screen.findByTestId("pix-view");
    await waitFor(() => expect(screen.queryByTestId("checkout-cart-changed")).toBeNull());

    // Another tab took the same line to three.
    rerender(flow("l1x3", createOrder));
    expect((await screen.findByTestId("checkout-cart-changed")).textContent).toContain("Seu carrinho mudou");

    fireEvent.click(screen.getByTestId("checkout-cart-changed-refresh"));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ method: "PIX" }));
    // The new code is for the new basket, so there is nothing left to warn about.
    await waitFor(() => expect(screen.queryByTestId("checkout-cart-changed")).toBeNull());
    expect(screen.getByTestId("pix-view")).toBeTruthy();
  });

  it("stays quiet while the basket is the one the code was raised from", async () => {
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: true, data: order("o1", "PIX", 690) }));
    const { rerender } = render(flow("l1x1", createOrder), { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId("checkout-method-PIX"));
    await screen.findByTestId("pix-view");
    // A re-read of the same cart (the focus refresh) hands back an equal signature.
    rerender(flow("l1x1", createOrder));
    await waitFor(() => expect(screen.queryByTestId("checkout-cart-changed")).toBeNull());
  });
});

describe("useBasketChanged", () => {
  it("never warns before the host's cart has answered, nor without a basket at all", () => {
    const o = order("o1", "CARD", 690);
    const loading = renderHook(() => useBasketChanged(o, { signature: null, ready: false }));
    expect(loading.result.current).toBe(false);
    const none = renderHook(() => useBasketChanged(o, undefined));
    expect(none.result.current).toBe(false);
  });

  it("records the basket when the order arrives, and again for a re-priced order", () => {
    const first = order("o1", "CARD", 690);
    const { result, rerender } = renderHook(
      ({ o, signature }: { o: CheckoutOrder; signature: string }) =>
        useBasketChanged(o, { signature, ready: true }),
      { initialProps: { o: first, signature: "l1x1" } },
    );
    expect(result.current).toBe(false);
    rerender({ o: first, signature: "l1x3" });
    expect(result.current).toBe(true);
    // The refresh hands back a NEW order object for the same id.
    rerender({ o: order("o1", "CARD", 2070), signature: "l1x3" });
    expect(result.current).toBe(false);
  });
});

describe("paymentRefresh", () => {
  it("re-prices a card order in place, and re-mints anything else", () => {
    const onGenerate = vi.fn();
    const onRefreshOrder = vi.fn();
    paymentRefresh(order("o1", "CARD", 690), onGenerate, onRefreshOrder)?.();
    expect(onRefreshOrder).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();

    paymentRefresh(order("o2", "PIX", 690), onGenerate, onRefreshOrder)?.();
    expect(onGenerate).toHaveBeenCalledWith("PIX");

    expect(paymentRefresh(null, onGenerate, onRefreshOrder)).toBeNull();
  });
});

describe("useOrderRefresh", () => {
  const base = { buyer: {}, saveProfile: false };

  it("asks the host for the same method and routes the answer", async () => {
    const fresh = order("o1", "CARD", 2070);
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: true, data: fresh }));
    const route = vi.fn();
    const { result } = renderHook(() =>
      useOrderRefresh({ ...base, order: order("o1", "CARD", 690), createOrder, route }),
    );
    act(() => result.current.run());
    await waitFor(() => expect(route).toHaveBeenCalledWith(fresh));
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ method: "CARD" }));
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it("keeps a refused refresh to show, instead of routing it", async () => {
    const error = { message: "Esta loja está fechada.", field: null, code: "STORE_CLOSED" };
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: false, error }));
    const route = vi.fn();
    const { result } = renderHook(() =>
      useOrderRefresh({ ...base, order: order("o1", "CARD", 690), createOrder, route }),
    );
    act(() => result.current.run());
    await waitFor(() => expect(result.current.error).toBe("Esta loja está fechada."));
    expect(route).not.toHaveBeenCalled();
  });

  it("forgets a failed refresh once the screen holds another order", async () => {
    const error = { message: "Esta loja está fechada.", field: null, code: "STORE_CLOSED" };
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: false, error }));
    const card = order("o1", "CARD", 690);
    const { result, rerender } = renderHook(
      ({ o }: { o: CheckoutOrder | null }) => useOrderRefresh({ ...base, order: o, createOrder, route: vi.fn() }),
      { initialProps: { o: card as CheckoutOrder | null } },
    );
    act(() => result.current.run());
    await waitFor(() => expect(result.current.error).toBe("Esta loja está fechada."));
    // The buyer switches to PIX: a new order is raised.
    rerender({ o: order("o2", "PIX", 690) });
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("fires once however many times it is pressed while one is out", async () => {
    const release: { go?: () => void } = {};
    const createOrder = vi.fn(
      () =>
        new Promise<CreateOrderResult>((resolve) => {
          release.go = () => resolve({ ok: true, data: order("o1", "CARD", 2070) });
        }),
    );
    const { result } = renderHook(() =>
      useOrderRefresh({ ...base, order: order("o1", "CARD", 690), createOrder, route: vi.fn() }),
    );
    act(() => result.current.run());
    await waitFor(() => expect(result.current.pending).toBe(true));
    act(() => result.current.run());
    expect(createOrder).toHaveBeenCalledTimes(1);
    await act(async () => release.go?.());
  });

  it("drops an answer for an order the screen has moved on from", async () => {
    const release: { go?: () => void } = {};
    const createOrder = vi.fn(
      () =>
        new Promise<CreateOrderResult>((resolve) => {
          release.go = () => resolve({ ok: true, data: order("o1", "CARD", 2070) });
        }),
    );
    const route = vi.fn();
    const { result, rerender } = renderHook(
      ({ o }: { o: CheckoutOrder | null }) => useOrderRefresh({ ...base, order: o, createOrder, route }),
      { initialProps: { o: order("o1", "CARD", 690) as CheckoutOrder | null } },
    );
    act(() => result.current.run());
    // The buyer switches method: the order on screen is dropped.
    rerender({ o: null });
    await act(async () => release.go?.());
    expect(route).not.toHaveBeenCalled();
  });
});

describe("useRefreshOnCartChanged", () => {
  function withRefresh(refresh: () => void) {
    return function RefreshWrapper({ children }: { children: ReactNode }): JSX.Element {
      return <PaymentRefreshProvider refresh={refresh}>{children}</PaymentRefreshProvider>;
    };
  }

  it("re-reads the order once when the host refused the charge with CART_CHANGED", () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ code }: { code: string | null }) => useRefreshOnCartChanged(code), {
      initialProps: { code: null as string | null },
      wrapper: withRefresh(refresh),
    });
    expect(refresh).not.toHaveBeenCalled();
    rerender({ code: CART_CHANGED_CODE });
    rerender({ code: CART_CHANGED_CODE });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire when the step hands down a new refresh for the same refusal", () => {
    const spy = vi.fn();
    function Probe({ code }: { code: string | null }): null {
      useRefreshOnCartChanged(code);
      return null;
    }
    const harness = (code: string | null): JSX.Element => (
      <PaymentRefreshProvider refresh={() => spy()}>
        <Probe code={code} />
      </PaymentRefreshProvider>
    );
    const { rerender } = render(harness(CART_CHANGED_CODE));
    rerender(harness(CART_CHANGED_CODE));
    rerender(harness(CART_CHANGED_CODE));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("leaves every other refusal alone", () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnCartChanged("PAYMENT_UNRESOLVED"), { wrapper: withRefresh(refresh) });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("CartChangedBoundary", () => {
  /** A pane holding typed state, like the card form. */
  function TypedPane(): JSX.Element {
    const [value, setValue] = useState("");
    return <input data-testid="typed" value={value} onChange={(e) => setValue(e.target.value)} />;
  }

  it("keeps the pane mounted — and what was typed in it — as the warning comes and goes", async () => {
    const view = (o: CheckoutOrder, signature: string): JSX.Element => (
      <CartChangedBoundary
        order={o}
        basket={{ signature, ready: true }}
        creating={false}
        onGenerate={vi.fn()}
        refresh={{ run: vi.fn(), pending: false, error: null }}
      >
        <TypedPane />
      </CartChangedBoundary>
    );
    const raised = order("o1", "CARD", 690);
    const { rerender } = render(view(raised, "l1x1"));
    fireEvent.change(screen.getByTestId("typed"), { target: { value: "4111 1111" } });

    rerender(view(raised, "l1x3"));
    await screen.findByTestId("checkout-cart-changed");
    // The refresh lands: a re-priced order for the cart as it stands.
    rerender(view(order("o1", "CARD", 2070), "l1x3"));
    await waitFor(() => expect(screen.queryByTestId("checkout-cart-changed")).toBeNull());

    expect((screen.getByTestId("typed") as HTMLInputElement).value).toBe("4111 1111");
  });
});

describe("the warning's own states", () => {
  const changedView = (refresh: { run: () => void; pending: boolean; error: string | null }) => {
    const raised = order("o1", "CARD", 690);
    const at = (signature: string): JSX.Element => (
      <CartChangedBoundary order={raised} basket={{ signature, ready: true }} creating={false} onGenerate={vi.fn()} refresh={refresh}>
        <span />
      </CartChangedBoundary>
    );
    return { first: at("l1x1"), changed: at("l1x3") };
  };

  it("waits on a refresh that is out: the control is disabled, not tappable twice", async () => {
    const v = changedView({ run: vi.fn(), pending: true, error: null });
    const { rerender } = render(v.first);
    rerender(v.changed);
    const button = (await screen.findByTestId("checkout-cart-changed-refresh")) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("says a failed refresh, with the same control to try again", async () => {
    const run = vi.fn();
    render(changedView({ run, pending: false, error: "Esta loja está fechada." }).first);
    expect((await screen.findByTestId("checkout-cart-changed-error")).textContent).toContain("Esta loja está fechada.");
    fireEvent.click(screen.getByTestId("checkout-cart-changed-refresh"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never warns on a settlement, which pays a balance rather than the cart", async () => {
    const settling = order("o1", "PIX", 690);
    const step = (signature: string): JSX.Element => (
      <PaymentStep
        method="PIX"
        onMethodChange={vi.fn()}
        order={settling}
        buyer={{}}
        creating={false}
        createError={null}
        errorField={null}
        onGenerate={vi.fn()}
        onUseEmail={vi.fn()}
        providerConfig={null}
        totalOverride={{ label: "R$ 6,90", items: 1 }}
        basket={{ signature, ready: true }}
        onResolved={vi.fn()}
      />
    );
    const { rerender } = render(step("l1x1"), { wrapper: Wrapper });
    await screen.findByTestId("pix-view");
    rerender(step("l1x3"));
    await waitFor(() => expect(screen.queryByTestId("checkout-cart-changed")).toBeNull());
  });
});
