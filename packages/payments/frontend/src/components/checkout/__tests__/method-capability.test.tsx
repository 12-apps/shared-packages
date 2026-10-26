// @vitest-environment jsdom
/**
 * FUT-698 — the Pagamento step derives its options from the chain's declared
 * capabilities (`capabilities.methods`, surfaced by `GET /api/checkout/config`).
 *
 * These are the browser-unreachable halves of the ticket's "método sem suporte
 * na cadeia não aparece" scenario: every adapter shipped today declares PIX and
 * CARD, so the missing-method case only exists synthetically. They ran on the
 * method tabs until FUT-4028 deleted them, and run on the one list's rows now.
 * Test names keep the scenario's Given/When/Then.
 */
import { afterEach, describe, expect, it } from "vitest";

import { googlePayConfig, handOffMethod } from "../method-capability";
import type { CheckoutProviderConfig, PaymentMethod } from "../types";
import { onPageStore, renderList, stubClient } from "./list-harness";
import { cleanup, screen } from "./test-utils";

afterEach(() => {
  cleanup();
});

function config(methods: CheckoutProviderConfig["methods"]): CheckoutProviderConfig {
  return {
    provider: "stone",
    tokenization: "PUBLIC_KEY",
    publicKey: "pk_stone",
    mockTokenization: false,
    methods,
  };
}

/** The online rows the list offers, read off their test ids. */
async function offeredRows(): Promise<string[]> {
  await screen.findByTestId("payment-list");
  return Array.from(document.querySelectorAll("[data-testid^='list-option-']"))
    .map((row) => row.getAttribute("data-testid") ?? "")
    .filter((id) => !id.endsWith("-radio") && !id.endsWith("-content"));
}

describe("the list's rows by capability (FUT-698)", () => {
  it("given the chain cannot PIX, when Pagamento renders, then PIX is not offered", async () => {
    renderList({ config: onPageStore({ methods: ["CARD"] }), client: stubClient() });

    expect(await offeredRows()).toEqual(["list-option-CARD"]);
  });

  it("given the chain cannot CARD, when Pagamento renders, then CARD is not offered", async () => {
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient() });

    expect(await offeredRows()).toEqual(["list-option-PIX"]);
  });

  it("given a chain that declares BOLETO, then only methods the checkout can drive appear", async () => {
    // Stone/Stripe declare BOLETO server-side, but this checkout has no boleto
    // UI — the list offers only what it can honour.
    renderList({
      // BOLETO is no `PaymentMethod` of this checkout — which is the point.
      config: onPageStore({ methods: ["PIX", "CARD", "BOLETO"] as unknown as PaymentMethod[] }),
      client: stubClient(),
    });

    expect(await offeredRows()).toEqual(["list-option-PIX", "list-option-CARD"]);
  });
});

describe("googlePayConfig — the wallet gate fails CLOSED (FUT-471)", () => {
  /** A one-entry chain, widened per case. */
  function chained(head: Record<string, unknown>): CheckoutProviderConfig {
    return {
      ...config(["PIX", "CARD"]),
      chain: [
        {
          provider: "pagbank",
          tokenization: "PUBLIC_KEY",
          publicKey: "pk",
          mockTokenization: false,
          methods: ["PIX", "CARD"],
          ...head,
        },
      ],
    };
  }

  it("answers the head's published parameters when everything is declared", () => {
    const head = {
      wallets: ["GOOGLE_PAY" as const],
      googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1" },
    };
    expect(googlePayConfig(chained(head))).toEqual({
      gateway: "pagbank",
      gatewayMerchantId: "MID_1",
      environment: "TEST",
    });
  });

  it("carries the connection's Google Pay environment, so a production store mints real tokens (FUT-3756)", () => {
    const head = {
      wallets: ["GOOGLE_PAY" as const],
      googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1", environment: "PRODUCTION" as const },
    };
    expect(googlePayConfig(chained(head))?.environment).toBe("PRODUCTION");
  });

  it("answers null while the config is loading — the opposite of the picker's fail-open", () => {
    // A missing button costs a tap; a button the store cannot charge sends the
    // buyer through the wallet sheet into a guaranteed refusal.
    expect(googlePayConfig(null)).toBeNull();
  });

  it("answers null for a chain served by an older host (no wallet fields)", () => {
    expect(googlePayConfig(chained({}))).toBeNull();
  });

  it("answers null when the capability is declared but the merchant id is missing", () => {
    const head = {
      wallets: ["GOOGLE_PAY" as const],
      googlePay: { gateway: "pagbank", gatewayMerchantId: null },
    };
    expect(googlePayConfig(chained(head))).toBeNull();
  });

  it("answers null when only a TAIL entry declares the wallet", () => {
    // The wallet token is minted against the head's gatewayMerchantId; a tail
    // declaration cannot be honoured from this browser.
    const tail = {
      provider: "other",
      tokenization: "PUBLIC_KEY" as const,
      publicKey: "pk2",
      mockTokenization: false,
      methods: ["CARD" as const],
      wallets: ["GOOGLE_PAY" as const],
      googlePay: { gateway: "other", gatewayMerchantId: "MID_2" },
    };
    const config_ = chained({});
    expect(googlePayConfig({ ...config_, chain: [...(config_.chain ?? []), tail] })).toBeNull();
  });
});

describe("handOffMethod — what a hand-off store charges on the buyer's behalf", () => {
  it("asks for PIX when the chain offers it", () => {
    // PIX is the one method whose first charge is ALWAYS raised immediately, so
    // it is the one that always comes back with a link to hand the buyer to. A
    // CARD request at a store that can tokenize somewhere in its chain is
    // answered with the bare order instead — nowhere to send anyone.
    expect(handOffMethod(["PIX", "CARD"])).toBe("PIX");
    expect(handOffMethod(["CARD", "PIX"])).toBe("PIX");
  });

  it("falls back to the chain's own method when it cannot PIX", () => {
    // The walk refuses a method the provider never declared, so asking for PIX
    // at a card-only store would fail the charge rather than raise it.
    expect(handOffMethod(["CARD"])).toBe("CARD");
  });

  it("reads an unknown or empty offer as PIX", () => {
    expect(handOffMethod(null)).toBe("PIX");
    expect(handOffMethod([])).toBe("PIX");
  });
});
