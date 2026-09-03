// @vitest-environment jsdom
/**
 * FUT-1179 — the Pagamento step never showed the amount.
 *
 * Before a method was chosen the step rendered a picker and nothing else, and
 * for a store that finishes on the provider's own page it was worse than that:
 * a buyer with a CPF on file skips Dados, so the flow OPENS on Pagamento, the
 * hand-off screen owns the only button, and the total lived exclusively on the
 * step they never saw. That checkout asked for money and sent the buyer to
 * another site to hand it over without the amount ever having been on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutFlow } from "../checkout-flow";
import { PaymentStep } from "../checkout-steps";
import { CheckoutCopyProvider } from "../copy-context";
import { EN_US_CHECKOUT_COPY } from "../en-US";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type { CheckoutProviderConfig } from "../types";
import { cleanup, render, screen, waitFor } from "./test-utils";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

const CART = { empty: false, totalLabel: "R$ 42,90", totalItems: 2 };

/** A store whose buyer finishes on the provider's own page. */
const HOSTED: CheckoutProviderConfig = {
  provider: "aurora",
  tokenization: "REDIRECT",
  publicKey: null,
  mockTokenization: false,
  methods: ["PIX", "CARD"],
  chain: [
    {
      provider: "aurora",
      displayName: "Aurora",
      tokenization: "REDIRECT",
      publicKey: null,
      mockTokenization: false,
      methods: ["PIX", "CARD"],
      checkoutScreen: "hosted-link",
    },
  ],
};

describe("the amount on the Pagamento step", () => {
  it("is on screen before any method is chosen", () => {
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
        providerConfig={null}
        cartTotals={CART}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByTestId("payment-step-total")).toBeTruthy();
    expect(screen.getByTestId("pay-bar-total").textContent).toBe("R$ 42,90");
  });

  it("shows the settled balance's total instead when one is being settled", () => {
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
        providerConfig={null}
        cartTotals={CART}
        totalOverride={{ label: "R$ 118,00", items: 5 }}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pay-bar-total").textContent).toBe("R$ 118,00");
  });

  it("renders nothing at all for a host that composed the step without totals", () => {
    // A blank "Total ·" beside an empty amount is worse than the silence this
    // ticket is about.
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
        providerConfig={null}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.queryAllByTestId("payment-step-total")).toHaveLength(0);
  });

  it("is on screen beside the button that sends a CPF-on-file buyer away", async () => {
    // The whole ticket in one render: hosted store, CPF on file, so the flow
    // opens on Pagamento and the hand-off invite owns the only action.
    render(
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={CART}
        createOrder={vi.fn()}
        onExitToMenu={vi.fn()}
        taxIdOnFile
        providerConfig={HOSTED}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("checkout-handoff-start")).toBeTruthy());
    expect(screen.getByTestId("payment-step-total")).toBeTruthy();
    expect(screen.getByTestId("pay-bar-total").textContent).toBe("R$ 42,90");
  });
});

/**
 * The caption beside the amount was the last hard-coded Portuguese string on
 * this bar — everything else became the host's word in FUT-760 and this one was
 * missed. FUT-1179 is what made it worth fixing rather than noting: the amount
 * now renders on TWO steps, so a package that ships an en-US pack was about to
 * render "2 itens" twice inside an English checkout.
 */
describe("the caption beside the amount", () => {
  it("counts in the host's own language", () => {
    render(
      <CheckoutCopyProvider copy={EN_US_CHECKOUT_COPY}>
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
          providerConfig={null}
          cartTotals={CART}
          onResolved={vi.fn()}
        />
      </CheckoutCopyProvider>,
    );

    expect(screen.getByText("Total · 2 items")).toBeTruthy();
  });

  it("keeps the pt-BR wording exactly as it shipped", () => {
    // Byte-identical to the template the component carried, so nothing changes
    // for a Brazilian shopper.
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
        providerConfig={null}
        cartTotals={{ empty: false, totalLabel: "R$ 9,90", totalItems: 1 }}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByText("Total · 1 item")).toBeTruthy();
  });
});
