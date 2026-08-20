// @vitest-environment jsdom
/**
 * FUT-698 — the method picker derives its options from the chain's declared
 * capabilities (`capabilities.methods`, surfaced by `GET /api/checkout/config`).
 *
 * These are the browser-unreachable halves of the ticket's "método sem suporte
 * na cadeia não aparece no picker" scenario: every adapter shipped today
 * declares PIX and CARD, so the missing-method case only exists synthetically.
 * Test names keep the scenario's Given/When/Then. Rendered with NO slot
 * provider on purpose (raw-MUI defaults carry the load-bearing test ids);
 * jest-dom is not a dependency here — DOM properties are asserted directly.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentStep } from "../checkout-steps";
import { googlePayConfig, handOffMethod } from "../method-capability";
import { MethodPicker } from "../method-picker";
import type { CheckoutProviderConfig } from "../types";

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

/** Render the Pagamento step with no order raised — just the picker. */
function renderPaymentStep(providerConfig: CheckoutProviderConfig | null): void {
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

/** The offered methods, read off the rendered radiogroup's testids. */
function offeredTestIds(): string[] {
  return Array.from(
    screen.getByTestId("checkout-method").querySelectorAll("[data-testid^='checkout-method-']"),
  ).map((option) => option.getAttribute("data-testid") ?? "");
}

describe("MethodPicker — method by capability (FUT-698)", () => {
  it("given the chain cannot PIX, when the picker renders, then PIX is not offered", () => {
    render(<MethodPicker value={null} onChange={vi.fn()} offered={["CARD"]} />);

    expect(offeredTestIds()).toEqual(["checkout-method-CARD"]);
  });

  it("given the chain cannot CARD, when the picker renders, then CARD is not offered", () => {
    render(<MethodPicker value={null} onChange={vi.fn()} offered={["PIX"]} />);

    expect(offeredTestIds()).toEqual(["checkout-method-PIX"]);
  });

  it("given the config has not answered yet, then every method renders (fail open)", () => {
    render(<MethodPicker value={null} onChange={vi.fn()} offered={null} />);

    expect(offeredTestIds()).toEqual(["checkout-method-PIX", "checkout-method-CARD"]);
  });

  it("card-path gating still wins over a chain that declares CARD", () => {
    // The chain CAN charge cards, but this browser has no way to mint one
    // (no scheme/key/stub) — the tile stays visible but DISABLED with a caption
    // (FUT-697 review): a removed tile would leave an unexplained one-option
    // "choice", while a disabled one says why.
    render(
      <MethodPicker value={null} onChange={vi.fn()} offered={["PIX", "CARD"]} cardUnavailable />,
    );

    expect(offeredTestIds()).toEqual(["checkout-method-PIX", "checkout-method-CARD"]);
    const cardTile = screen.getByTestId("checkout-method-CARD") as HTMLButtonElement;
    expect(cardTile.disabled).toBe(true);
    expect(screen.getByText("Indisponível nesta loja")).toBeTruthy();
  });
});

describe("PaymentStep — the config's methods reach the picker (FUT-698)", () => {
  it("given a chain that only PIXes, when Pagamento renders, then card is never offered", () => {
    renderPaymentStep(config(["PIX"]));

    expect(offeredTestIds()).toEqual(["checkout-method-PIX"]);
  });

  it("given a chain that declares BOLETO, then only methods the checkout can drive appear", () => {
    renderPaymentStep(config(["PIX", "CARD", "BOLETO"]));

    // Stone/Stripe declare BOLETO server-side (true), but this checkout has no
    // boleto UI yet (phase 2) — the picker offers only what it can honour.
    expect(screen.getByTestId("checkout-method-PIX")).toBeTruthy();
    expect(screen.getByTestId("checkout-method-CARD")).toBeTruthy();
    expect(screen.getByTestId("checkout-method").querySelectorAll("[role='radio']")).toHaveLength(
      2,
    );
  });

  it("given no config yet, then Pagamento offers both methods as before", () => {
    renderPaymentStep(null);

    expect(screen.getByTestId("checkout-method-PIX")).toBeTruthy();
    expect(screen.getByTestId("checkout-method-CARD")).toBeTruthy();
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
    });
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
