// @vitest-environment jsdom
/**
 * FUT-3232 — the PIX tile under a store that confirms Pix by hand. The
 * library's own line, "Aprovação imediata", is false there: nothing approves
 * it but a person at the store. The chain says which provider a PIX charge
 * reaches (its FIRST PIX entry), and that entry's `confirmation` picks the line.
 */
import { cleanup, render, screen } from "./test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentStep } from "../checkout-steps";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";
import type { CheckoutChainLink, CheckoutProviderConfig } from "../types";

afterEach(() => {
  cleanup();
});

function link(provider: string, methods: CheckoutChainLink["methods"], confirmation?: "MANUAL"): CheckoutChainLink {
  return {
    provider,
    tokenization: "NONE",
    publicKey: null,
    mockTokenization: false,
    methods,
    ...(confirmation ? { confirmation } : {}),
  };
}

function config(chain: CheckoutChainLink[]): CheckoutProviderConfig {
  return {
    provider: chain[0]?.provider ?? null,
    tokenization: "PUBLIC_KEY",
    publicKey: "pk",
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain,
  };
}

function pixLine(providerConfig: CheckoutProviderConfig): string {
  render(
    <PaymentStep
      method={null}
      onMethodChange={vi.fn()}
      order={null}
      buyer={{}}
      creating={false}
      createError={null}
      errorField={null}
      onGenerate={vi.fn()}
      onUseEmail={vi.fn()}
      providerConfig={providerConfig}
      onResolved={vi.fn()}
    />,
  );
  return screen.getByTestId("checkout-method-PIX").textContent ?? "";
}

describe("the PIX tile says who approves it", () => {
  it("says the store confirms it when the first PIX provider is manual", () => {
    const line = pixLine(config([link("pixmanual", ["PIX"], "MANUAL"), link("pagbank", ["PIX", "CARD"])]));

    expect(line).toContain("Confirmado pela loja");
    expect(line).not.toContain(PT_BR_CHECKOUT_SCREENS_COPY.method.pixDescription);
  });

  it("keeps the instant line when a bank-confirmed provider comes first", () => {
    const line = pixLine(config([link("itau", ["PIX"]), link("pixmanual", ["PIX"], "MANUAL")]));

    expect(line).toContain(PT_BR_CHECKOUT_SCREENS_COPY.method.pixDescription);
  });

  it("skips a card-only head to find the provider PIX actually reaches", () => {
    const line = pixLine(config([link("stripe", ["CARD"]), link("pixmanual", ["PIX"], "MANUAL")]));

    expect(line).toContain("Confirmado pela loja");
  });
});
