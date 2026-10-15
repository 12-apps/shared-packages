// @vitest-environment jsdom
/**
 * FUT-3591 review round 1 — the hooks under the list, one rule each:
 *
 *  - `useSavedCards` lands the cards and the preselected one in ONE render
 *    (main's behaviour; the tabs layout's new-card form must not flash);
 *  - a refused key refresh still answers, so the charge is not held forever;
 *  - the charge starts only from rest — a second press is ignored;
 *  - choosing the card again after a refusal selects no saved card (FUT-1145).
 */
import type { JSX, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, renderHook, waitFor } from "./test-utils";

import { NEW_CARD } from "../../../card";
import { useCardPublicKey, useSavedCards } from "../card-sources";
import { CheckoutClientProvider } from "../client-context";
import type { CheckoutClient } from "../transport";
import { useListCharge } from "../list/use-list-charge";
import { useListState } from "../list/use-list-state";
import { SAVED_VISA, onPageStore, orderFor, stubClient } from "./list-harness";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function withClient(client: ReturnType<typeof stubClient>) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <CheckoutClientProvider client={client as unknown as CheckoutClient}>{children}</CheckoutClientProvider>;
  };
}

describe("useSavedCards", () => {
  it("never renders the saved cards with the new-card form selected", async () => {
    const seen: { cards: number; selection: string }[] = [];
    renderHook(
      () => {
        const saved = useSavedCards("loja-1", false);
        seen.push({ cards: saved.savedCards.length, selection: saved.selection });
        return saved;
      },
      { wrapper: withClient(stubClient([SAVED_VISA])) },
    );
    await waitFor(() => expect(seen.at(-1)).toEqual({ cards: 1, selection: "vault-1" }));
    expect(seen.some((render) => render.cards > 0 && render.selection === NEW_CARD)).toBe(false);
  });
});

describe("useCardPublicKey", () => {
  it("stops waiting when the refresh itself fails", async () => {
    const client = stubClient();
    client.refreshBrowserKey.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useCardPublicKey("o-1", { provider: "pagbank", publicKey: null, mockTokenization: false }), {
      wrapper: withClient(client),
    });
    expect(result.current.keyPending).toBe(true);
    await waitFor(() => expect(result.current.keyPending).toBe(false));
  });
});

describe("useListCharge", () => {
  it("starts only from rest: a second press raises nothing more", async () => {
    vi.useFakeTimers();
    const startPayment = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useListCharge({ order: null, creating: false, createError: null, setMethod: vi.fn(), startPayment, cartTotal: "R$ 27,00" }),
    );
    act(() => result.current.start("CARD", "R$ 27,00"));
    act(() => result.current.start("CARD", "R$ 27,00"));
    act(() => result.current.start("GOOGLE_PAY", "R$ 27,00"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(startPayment).toHaveBeenCalledTimes(1);
  });

  it("reuses a held CARD order only while it costs what the cart does", () => {
    const held = orderFor("CARD");
    const ports = { creating: false, createError: null, setMethod: vi.fn(), startPayment: vi.fn(async () => undefined) };
    const same = renderHook(() => useListCharge({ ...ports, order: held, cartTotal: "R$ 27,00" }));
    act(() => same.result.current.start("GOOGLE_PAY", "R$ 27,00"));
    expect(ports.startPayment).not.toHaveBeenCalled();
    expect(same.result.current.chargeable).toBe(held);
    const moved = renderHook(() => useListCharge({ ...ports, order: held, cartTotal: "R$ 22,00" }));
    act(() => moved.result.current.start("GOOGLE_PAY", "R$ 22,00"));
    expect(ports.startPayment).toHaveBeenCalledTimes(1);
    expect(moved.result.current.chargeable).toBeNull();
  });
});

describe("useListState", () => {
  it("selects no saved card when the card is chosen again after a refusal", async () => {
    const capability = { handOff: false, offered: null, cardUnavailable: false, googlePayReady: false };
    const { result } = renderHook(
      () => useListState({ config: onPageStore(), capability, tenantSlug: "loja-1", fresh: true, arrivedWith: {}, taxIdOnFile: true }),
      { wrapper: withClient(stubClient([SAVED_VISA])) },
    );
    await waitFor(() => expect(result.current.card.saved).toHaveLength(1));
    act(() => result.current.choose({ kind: "online", method: "PIX" }));
    act(() => result.current.choose({ kind: "online", method: "CARD" }));
    expect(result.current.card.selection).toBeNull();
  });
});
