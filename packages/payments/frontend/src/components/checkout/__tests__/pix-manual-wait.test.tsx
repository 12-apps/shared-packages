// @vitest-environment jsdom
/**
 * A Pix only the STORE can confirm (`PixCharge.confirmation: 'MANUAL'`, the
 * `pixmanual` provider). No bank tells anyone it was paid, so the pane must
 * not promise "a confirmação é automática", and the wait runs for as long as
 * the store has to answer — up to the code's own expiry, a day at most.
 */
import { act, cleanup, render, screen } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX, ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { PixView } from "../pix-view";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, OrderStatus } from "../types";
import type { Result } from "../../../result";

/** A fixed instant, so every expiry below is the same span on every run. */
const NOW = new Date("2026-10-02T12:00:00.000Z").getTime();
const DAY_MS = 24 * 60 * 60_000;

function pixOrder(confirmation: "MANUAL" | undefined, lifetimeMs: number): CheckoutOrder {
  return {
    orderId: "o-manual",
    status: "AWAITING_PAYMENT",
    method: "PIX",
    totalCents: 4250,
    subtotalCents: 4250,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: "R$ 42,50",
    pix: {
      copyPaste: "00020126BR.GOV.BCB.PIX",
      expiresAt: new Date(NOW + lifetimeMs).toISOString(),
      ...(confirmation ? { confirmation } : {}),
    },
  };
}

/** A server whose answer the test sets; the tally lives on one object (flakiness lane). */
function storeServer(): { client: CheckoutClient; answer: (status: OrderStatus) => void; asked: () => number } {
  const state: { answer: Result<OrderStatus>; asked: number } = {
    answer: { ok: true, data: "AWAITING_PAYMENT" },
    asked: 0,
  };
  const client = {
    getStatus: async () => {
      state.asked += 1;
      return state.answer;
    },
  } as unknown as CheckoutClient;
  return {
    client,
    answer: (status) => {
      state.answer = { ok: true, data: status };
    },
    asked: () => state.asked,
  };
}

function withClient(client: CheckoutClient) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>;
  };
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}


describe("a Pix the store confirms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says the store confirms it, and never that the confirmation is automatic", async () => {
    const { client } = storeServer();
    render(<PixView order={pixOrder("MANUAL", 30 * 60_000)} onResolved={vi.fn()} />, { wrapper: withClient(client) });
    await elapse(0);

    const pane = screen.getByTestId("pix-view").textContent ?? "";
    // The instructions paragraph went with the 2026-10-06 redesign (FUT-3367
    // R8); who confirms is now said by the deadline line and the wait.
    expect(screen.getByTestId("pix-expiry").textContent).toContain("A loja confirma o pagamento até");
    expect(screen.getByTestId("pix-awaiting").textContent).toBe(PT_BR_CHECKOUT_SCREENS_COPY.pix.manual?.awaiting);
    // The owner's own words for the wait, pinned literally: FUT-3232's, as the
    // owner replaced them in the approved prototype (FUT-3367 D4).
    expect(screen.getByTestId("pix-awaiting").textContent).toBe("Aguardando confirmação da loja…");
    expect(pane).not.toMatch(/automátic/i);
  });

  it("keeps waiting for hours when the store has a day, and moves on once it confirms", async () => {
    const server = storeServer();
    const onResolved = vi.fn();
    render(<PixView order={pixOrder("MANUAL", DAY_MS)} onResolved={onResolved} />, { wrapper: withClient(server.client) });

    await elapse(3 * 60 * 60_000);
    expect(screen.getByTestId("pix-awaiting")).toBeTruthy();
    const askedSoFar = server.asked();

    server.answer("PAID");
    await elapse(20_000);

    expect(server.asked()).toBeGreaterThan(askedSoFar);
    expect(onResolved).toHaveBeenCalledWith("PAID");
  });

  it("leaves an automatic Pix as it was", async () => {
    const { client } = storeServer();
    render(<PixView order={pixOrder(undefined, 30 * 60_000)} onResolved={vi.fn()} />, { wrapper: withClient(client) });
    await elapse(0);

    expect(screen.getByTestId("pix-awaiting").textContent).toBe(PT_BR_CHECKOUT_SCREENS_COPY.pix.awaiting);
    expect(screen.getByTestId("pix-expiry").textContent).toMatch(/automática/);
  });
});
