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
import { MethodPicker } from "../method-picker";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";
import type { CheckoutChainLink, CheckoutProviderConfig } from "../types";

afterEach(() => {
  cleanup();
});

function link(
  provider: string,
  methods: CheckoutChainLink["methods"],
  confirmation?: "AUTOMATIC" | "MANUAL",
): CheckoutChainLink {
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

function renderStep(providerConfig: CheckoutProviderConfig | null): void {
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
}

const method = PT_BR_CHECKOUT_SCREENS_COPY.method;

describe("the method tiles are one line (the 2026-10-06 Pix redesign)", () => {
  it("names each method and nothing else, whoever confirms the Pix", () => {
    renderStep(config([link("pixmanual", ["PIX"], "MANUAL"), link("pagbank", ["PIX", "CARD"])]));

    expect(screen.getByTestId("checkout-method-PIX").textContent).toBe(method.pixLabel);
    expect(screen.getByTestId("checkout-method-CARD").textContent).toBe(method.cardLabel);
    // The old description lines are gone from the tiles, manual and instant alike.
    const picker = screen.getByTestId("checkout-method").textContent ?? "";
    expect(picker).not.toContain(method.pixManualDescription ?? "never");
    expect(picker).not.toContain(method.pixDescription);
    expect(picker).not.toContain(method.cardDescription);
  });

  it("keeps the group's name for a screen reader, without drawing it", () => {
    renderStep(config([link("pagbank", ["PIX", "CARD"])]));

    expect(screen.getByRole("radiogroup", { name: method.groupLabel })).toBeTruthy();
    expect(screen.getByTestId("checkout-method").textContent).not.toContain(method.groupLabel);
  });

  it("says why a card tile is disabled, and ties the reason to the tile", () => {
    render(<MethodPicker value={null} onChange={vi.fn()} offered={["PIX", "CARD"]} cardUnavailable />);

    const tile = screen.getByTestId("checkout-method-CARD") as HTMLButtonElement;
    const reason = screen.getByTestId("method-reason-CARD");
    expect(tile.disabled).toBe(true);
    expect(reason.textContent).toBe(method.unavailableHere);
    expect(tile.getAttribute("aria-describedby")).toBe("method-reason-CARD");
  });

});
