// @vitest-environment jsdom
/**
 * THE ENGINE'S OWN TWO SENTENCES (FUT-1240).
 *
 * Everything else on a checkout screen belongs to a step, a gate or a
 * registered method. These two belong to the engine — what is on screen when
 * there is nothing to show yet, and what a shopper reads between choosing a
 * method and the provider's own surface arriving — so they are REQUIRED host
 * copy in both packs, like every other sentence this package renders.
 *
 * `locales.test.ts` already proves the two packs have the same SHAPE. What is
 * pinned here is that the keys exist at all, that the per-method one is keyed
 * by the method's id rather than by a word, and that the engine actually reads
 * them: a copy port that is required and unread is the failure FUT-760 spent a
 * whole ticket on.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN_US_CHECKOUT_VIEW_COPY } from "../../../components/checkout/en-US";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../../../components/checkout/pt-BR";
import { CARD_METHOD, PIX_METHOD } from "../methods";

import { orderOf } from "./fixtures";
import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

const PACKS = [
  ["pt-BR", PT_BR_CHECKOUT_VIEW_COPY],
  ["en-US", EN_US_CHECKOUT_VIEW_COPY],
] as const;

describe("both packs answer the engine", () => {
  it.each(PACKS)("%s has a loading sentence", (_tag, copy) => {
    expect(copy.pipeline.loading.length).toBeGreaterThan(0);
  });

  it.each(PACKS)("%s has an awaitingHandover line per package method", (_tag, copy) => {
    // Keyed by the descriptor's id, so a host registering a charged method of
    // its own adds one line rather than editing a union.
    for (const method of [PIX_METHOD, CARD_METHOD]) {
      expect(copy.pipeline.awaitingHandover[method.id]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("the engine reads them", () => {
  it("shows the chosen method's own hand-off line", async () => {
    const navigate = vi.fn<(url: string) => void>();
    const { flows } = buildHost(
      { settlementMethods: [] },
      {
        taxIdOnFile: true,
        navigate,
        createPayable: async () => ({
          ok: true,
          data: orderOf({ method: "PIX", hostedCheckoutUrl: "https://provider.example/pay" }),
        }),
      },
    );
    render(<flows.Checkout />);
    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    const waiting = await screen.findByTestId("checkout-awaiting-handover");
    expect(waiting.textContent).toBe(PT_BR_CHECKOUT_VIEW_COPY.pipeline.awaitingHandover["PIX"]);
    // The interstitial's own job is unchanged: park, then leave.
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  });
});
