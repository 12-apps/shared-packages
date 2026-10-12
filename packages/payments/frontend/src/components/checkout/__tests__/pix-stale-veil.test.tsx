// @vitest-environment jsdom
/**
 * FUT-3535 — while "Seu carrinho mudou" stands over a PIX, its code cannot be
 * copied or scanned.
 *
 * The amount is IN the code, so the code on screen is the OLD order's once the
 * cart moved (FUT-1139). The warning alone left it readable and copyable under
 * it; a buyer who copied it anyway paid an order that no longer described the
 * cart. Now the QR and the code are veiled — blurred, out of a screen reader's
 * and a pointer's reach, "Atualize para gerar um novo Pix" over them — and
 * every copy control waits until the step brings a new code.
 */
import type { JSX, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutClientProvider } from "../client-context";
import { CheckoutFlow } from "../checkout-flow";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, CreateOrderResult, OrderStatus } from "../types";
import type { Result } from "../../../result";
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";

const EXPIRES_AT = "2099-01-01T00:00:00.000Z";
const AWAITING: Result<OrderStatus> = { ok: true, data: "AWAITING_PAYMENT" };
const CLIENT = { getStatus: async () => AWAITING } as unknown as CheckoutClient;
const VEIL = PT_BR_CHECKOUT_SCREENS_COPY.cartChanged.pixVeil;

function pixOrder(totalCents: number): CheckoutOrder {
  return {
    orderId: "o1",
    status: "AWAITING_PAYMENT",
    method: "PIX",
    totalCents,
    subtotalCents: totalCents,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: `R$ ${(totalCents / 100).toFixed(2).replace(".", ",")}`,
    pix: { copyPaste: `00020126BR.GOV.BCB.PIX.o1.${totalCents}`, expiresAt: EXPIRES_AT },
  };
}

function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <CheckoutClientProvider client={CLIENT}>{children}</CheckoutClientProvider>;
}

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

const copyButton = (): HTMLButtonElement => screen.getByTestId("pix-copy") as HTMLButtonElement;
const veils = (): HTMLElement[] => screen.queryAllByTestId("pix-stale-veil");

/** Raise a PIX on the first basket, then change the cart under it. */
async function staleCode(createOrder: () => Promise<CreateOrderResult>): Promise<void> {
  const { rerender } = render(flow("l1x1", createOrder), { wrapper: Wrapper });
  fireEvent.click(screen.getByTestId("checkout-method-PIX"));
  await screen.findByTestId("pix-view");
  rerender(flow("l1x3", createOrder));
  await screen.findByTestId("checkout-cart-changed");
}

/** A clipboard that takes every write, fresh for the test that asks for it. */
function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a PIX whose cart changed under it (FUT-3535)", () => {
  it("draws the code and the QR in the clear, and lets them be copied, while the cart is the one they were raised for", async () => {
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: true, data: pixOrder(690) }));
    render(flow("l1x1", createOrder), { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId("checkout-method-PIX"));
    await screen.findByTestId("pix-view");
    await waitFor(() => expect(veils()).toHaveLength(0));
    expect(copyButton().disabled).toBe(false);
  });

  it("veils the QR and the code, says why, and refuses the copy", async () => {
    const writeText = stubClipboard();
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: true, data: pixOrder(690) }));
    await staleCode(createOrder);

    await waitFor(() => expect(veils()).toHaveLength(2));
    for (const veil of veils()) {
      expect(veil.textContent).toContain(VEIL);
      // The blurred content is out of a screen reader's reach; the sentence is not.
      expect(veil.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(screen.getByTestId("pix-code").closest("[aria-hidden='true']")).not.toBeNull();

    expect(copyButton().disabled).toBe(true);
    fireEvent.click(copyButton());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("lifts the veil with the new code once the payment is updated", async () => {
    const raised = [pixOrder(690), pixOrder(2070)];
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: true, data: raised.shift()! }));
    await staleCode(createOrder);

    fireEvent.click(screen.getByTestId("checkout-cart-changed-refresh"));
    await waitFor(() => expect(screen.getByTestId("pix-code").textContent).toContain(".2070"));
    await waitFor(() => expect(veils()).toHaveLength(0));
    expect(copyButton().disabled).toBe(false);
  });

  it("leaves no old code to copy when the update fails", async () => {
    const answers: CreateOrderResult[] = [
      { ok: true, data: pixOrder(690) },
      { ok: false, error: { code: "NETWORK", message: "Sem conexão.", field: null } },
    ];
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => answers.shift()!);
    await staleCode(createOrder);

    // A PIX is updated by minting a new code, which takes the old one off the
    // screen first: a failure leaves the step's error, not a copyable old code.
    fireEvent.click(screen.getByTestId("checkout-cart-changed-refresh"));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryAllByTestId("pix-code")).toHaveLength(0));
    expect(screen.queryAllByTestId("pix-copy")).toHaveLength(0);
  });

  it("refuses the after-copy face's copy too, and veils its QR", async () => {
    const writeText = stubClipboard();
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: true, data: pixOrder(690) }));
    const { rerender } = render(flow("l1x1", createOrder), { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId("checkout-method-PIX"));
    await screen.findByTestId("pix-view");
    fireEvent.click(copyButton());
    await screen.findByTestId("pix-after-copy");
    // The first copy, before the cart moved, is the only one there may be.
    expect(writeText).toHaveBeenCalledTimes(1);

    rerender(flow("l1x3", createOrder));
    await screen.findByTestId("checkout-cart-changed");
    const again = screen.getByTestId("pix-copy-again") as HTMLButtonElement;
    await waitFor(() => expect(again.disabled).toBe(true));
    fireEvent.click(again);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(veils()).toHaveLength(1);
  });
});
