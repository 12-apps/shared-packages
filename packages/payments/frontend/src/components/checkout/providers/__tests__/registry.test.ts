/**
 * Screen id → flow shape (FUT-596).
 *
 * The claims under test: a declared id decides whether the buyer is handed
 * over, an UNDECLARED or UNKNOWN id falls back to the capability read rather
 * than a guess, and an id that collides with `Object.prototype` is no shape.
 *
 * The unknown-id case is the one that matters most in production:
 * `@12-apps/payments-backend` and `@12-apps/payments-frontend` version
 * independently, so a host running a newer server than bundle publishes ids
 * this table has never seen.
 */
import { describe, expect, it } from "vitest";

import type { CheckoutProviderConfig } from "../../types";
import { methodChosenAtProvider } from "../registry";

/** A store whose chain head declares `screen`, with an in-browser card path. */
function storeWith(screenId: string | null): CheckoutProviderConfig {
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
        checkoutScreen: screenId,
      },
    ],
  };
}

/** A store whose card is taken on the provider's own page. */
function hostedStore(screenId: string | null): CheckoutProviderConfig {
  return {
    provider: "acme",
    tokenization: "REDIRECT",
    publicKey: null,
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "acme",
        tokenization: "REDIRECT",
        publicKey: null,
        mockTokenization: false,
        methods: ["PIX", "CARD"],
        checkoutScreen: screenId,
      },
    ],
  };
}

describe("who asks the buyer PIX-or-card", () => {
  it("is the provider, for a declared hand-off screen", () => {
    expect(methodChosenAtProvider("hosted-link", hostedStore("hosted-link"))).toBe(true);
  });

  it("is us, for a screen that collects on our page", () => {
    expect(methodChosenAtProvider("pix-and-card", storeWith("pix-and-card"))).toBe(false);
  });

  it("lets a declaration win over the capability read", () => {
    expect(methodChosenAtProvider("pix-and-card", hostedStore("pix-and-card"))).toBe(false);
    expect(methodChosenAtProvider("hosted-link", storeWith("hosted-link"))).toBe(true);
  });

  it("follows the CAPABILITY read when nothing is declared", () => {
    expect(methodChosenAtProvider(null, hostedStore(null))).toBe(true);
    expect(methodChosenAtProvider(null, storeWith(null))).toBe(false);
  });

  it("follows the capability read for an id from a NEWER server too", () => {
    // The version-skew case: an unknown id is not a hand-off declaration, and
    // must not silently take the choice away from a store that needs one.
    expect(methodChosenAtProvider("a-screen-from-a-newer-server", hostedStore(null))).toBe(true);
    expect(methodChosenAtProvider("a-screen-from-a-newer-server", storeWith(null))).toBe(false);
  });

  it("reads an id that collides with Object.prototype as unknown", () => {
    expect(methodChosenAtProvider("constructor", storeWith(null))).toBe(false);
    expect(methodChosenAtProvider("toString", hostedStore(null))).toBe(true);
  });

  it("keeps the choice on our page while the config is still loading", () => {
    // Fail OPEN: a `null` config is "we do not know yet", and taking the
    // choice away on a guess would send a buyer off-site for nothing.
    expect(methodChosenAtProvider(null, null)).toBe(false);
    expect(methodChosenAtProvider(undefined, null)).toBe(false);
  });

  it("does NOT read a PIX-only store as hosted (the FUT-747 correction)", () => {
    const pixOnly: CheckoutProviderConfig = {
      provider: "acme",
      tokenization: "NONE",
      publicKey: null,
      mockTokenization: false,
      methods: ["PIX"],
      chain: [{ provider: "acme", tokenization: "NONE", publicKey: null, mockTokenization: false, methods: ["PIX"], checkoutScreen: null }],
    };
    expect(methodChosenAtProvider(null, pixOnly)).toBe(false);
  });

  it("keeps a PIX-on-page head ahead of a hosted card tail on our page", () => {
    const mixed: CheckoutProviderConfig = {
      provider: "pixbank",
      tokenization: "NONE",
      publicKey: null,
      mockTokenization: false,
      methods: ["PIX", "CARD"],
      chain: [
        { provider: "pixbank", tokenization: "NONE", publicKey: null, mockTokenization: false, methods: ["PIX"], checkoutScreen: null },
        { provider: "linkpay", tokenization: "REDIRECT", publicKey: null, mockTokenization: false, methods: ["PIX", "CARD"], checkoutScreen: null },
      ],
    };
    expect(methodChosenAtProvider(null, mixed)).toBe(false);
  });
});
