// @vitest-environment jsdom
/**
 * FUT-4416 — a held CARD order (a refused card the buyer retries, FUT-179) is
 * reused while it asks the provider for what the charge would ask now. Once
 * the chosen row, or the wallets, carry their OWN price, the order's total is
 * that price and no longer the cart's, so the cents alone decide: the same
 * cents reuse it, other cents raise a fresh one. With no price, the cart's
 * total still decides, as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "./test-utils";
import { useListCharge } from "../list/use-list-charge";
import { orderFor } from "./list-harness";

/** The card's order, priced at the credit price — not the cart's R$ 143,00. */
const held = orderFor("CARD", { totalCents: 13870, amountDueCents: 13870, totalLabel: "R$ 138,70" });

function ports() {
  return { creating: false, createError: null, setMethod: vi.fn(), startPayment: vi.fn(async () => undefined), order: held, cartTotal: "R$ 143,00" };
}

afterEach(() => vi.useRealTimers());

describe("a priced choice", () => {
  it("reuses the held card order that asks the chosen row's cents, though its total is not the cart's", async () => {
    vi.useFakeTimers();
    const host = ports();
    const { result } = renderHook(() => useListCharge({ ...host, dueCents: 14300, priced: { choice: 13870 } }));
    act(() => result.current.start("CARD", "R$ 138,70"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(host.startPayment).not.toHaveBeenCalled();
    expect(result.current.chargeable).toBe(held);
  });

  it("raises a fresh order when the chosen row now asks other cents", async () => {
    vi.useFakeTimers();
    const host = ports();
    const { result } = renderHook(() => useListCharge({ ...host, priced: { choice: 13603 } }));
    act(() => result.current.start("CARD", "R$ 136,03"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(host.startPayment).toHaveBeenCalledTimes(1);
  });

  it("a wallet's press is judged by the wallets' price, not the chosen row's", () => {
    const host = ports();
    const { result } = renderHook(() => useListCharge({ ...host, priced: { choice: 12675, wallets: 13870 } }));
    act(() => result.current.start("GOOGLE_PAY", "R$ 138,70"));
    expect(host.startPayment).not.toHaveBeenCalled();
    expect(result.current.chargeable).toBe(held);
  });
});

describe("a priced choice whose label and amount due still match", () => {
  it("re-raises the card when only the row's own cents moved", async () => {
    vi.useFakeTimers();
    const host = { ...ports(), order: orderFor("CARD"), cartTotal: "R$ 27,00" };
    const { result } = renderHook(() => useListCharge({ ...host, dueCents: 2700, priced: { choice: 2500 } }));
    act(() => result.current.start("CARD", "R$ 25,00"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(host.startPayment).toHaveBeenCalledTimes(1);
    expect(result.current.chargeable).toBeNull();
  });
});

describe("no price", () => {
  it("still raises a fresh order when the held one's total is not the cart's", () => {
    const host = ports();
    const { result } = renderHook(() => useListCharge({ ...host, dueCents: 13870 }));
    act(() => result.current.start("GOOGLE_PAY", "R$ 143,00"));
    expect(host.startPayment).toHaveBeenCalledTimes(1);
  });
});
