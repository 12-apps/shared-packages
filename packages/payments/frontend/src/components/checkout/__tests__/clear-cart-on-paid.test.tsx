// @vitest-environment jsdom
/**
 * A buyer who paid must not be handed their cart back.
 *
 * FUT-601 fixed the SERVER half: the cart is emptied inside the confirmation
 * transaction, for the delivery that won the claim. Nothing told the SPA — its
 * cart provider survives every checkout route change and kept the snapshot it
 * seeded on mount, so the buyer pressed "Voltar ao cardápio" and found the
 * badge still counting the items they had just bought.
 *
 * Since FUT-564 the flow lives in this package and the cart lives in the host,
 * so the client half of that fix is a PORT: `onPaid` fires when — and only
 * when — the order settles PAID. The host re-reads its server-emptied cart
 * there; a payment that did not go through fires nothing, because that shopper
 * still has a basket to retry with.
 */
import { act, renderHook, waitFor } from "./test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";

/** One test's own port set — every callback a fresh spy. */
function makePorts(): CheckoutHostPorts & { onPaid: ReturnType<typeof vi.fn> } {
  return {
    createOrder: vi.fn(),
    saveBuyerContact: vi.fn(),
    onExitToMenu: vi.fn(),
    onPaid: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the host's onPaid port after a checkout settles", () => {
  it("fires once the order is PAID", async () => {
    const ports = makePorts();
    const { result } = renderHook(() => useCheckoutController(ports));

    act(() => {
      result.current.handleResolved("PAID");
    });

    await waitFor(() => {
      expect(ports.onPaid).toHaveBeenCalledTimes(1);
    });
  });

  it("stays silent when the payment failed", async () => {
    const ports = makePorts();
    const { result } = renderHook(() => useCheckoutController(ports));

    act(() => {
      result.current.handleResolved("FAILED");
    });

    // The step advanced, so the effect has had its chance to run.
    await waitFor(() => {
      expect(result.current.finalStatus).toBe("FAILED");
    });
    expect(ports.onPaid).not.toHaveBeenCalled();
  });
});
