// @vitest-environment jsdom
/**
 * The hosted-link screen, which the payment list still mounts for a store that
 * takes the card on the provider's own page (`list/payment-list-step.tsx`).
 *
 * Kept from the screen-resolution suite when the tabbed checkout it also
 * covered was deleted (FUT-3811): the hand-off renders alone, with no card or
 * PIX pane beside it, and nothing renders before the buyer picks a method.
 */
import { render, screen } from "../../__tests__/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { CheckoutProviderConfig } from "../../types";
import { HostedLinkScreen } from "../hosted-link";
import type { ProviderCheckoutScreenProps } from "../types";

const BUYER = { name: "Ana", email: "ana@example.com", phone: "", taxId: "" };

/** A store whose chain head declares the hosted-link screen. */
function hostedLinkStore(): CheckoutProviderConfig {
  return {
    provider: "acme",
    tokenization: "PUBLIC_KEY",
    publicKey: "pk_test",
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "acme",
        tokenization: "PUBLIC_KEY",
        publicKey: "pk_test",
        mockTokenization: false,
        methods: ["PIX", "CARD"],
        checkoutScreen: "hosted-link",
      },
    ],
  };
}

function props(over: Partial<ProviderCheckoutScreenProps> = {}): ProviderCheckoutScreenProps {
  return { order: null, buyer: BUYER, config: hostedLinkStore(), method: null, onResolved: vi.fn(), ...over };
}

describe("HostedLinkScreen", () => {
  it("renders the hand-off and never a card or PIX pane", () => {
    render(<HostedLinkScreen {...props({ method: "CARD" })} />);
    expect(screen.getByTestId("checkout-handoff-pending")).toBeTruthy();
    expect(screen.queryAllByTestId("card-entry")).toHaveLength(0);
    expect(screen.queryAllByTestId("pix-view")).toHaveLength(0);
  });

  it("stays out of the way until a method is chosen", () => {
    const { container } = render(<HostedLinkScreen {...props({ method: null })} />);
    expect(container.innerHTML).toBe("");
  });
});
