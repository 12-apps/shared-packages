// @vitest-environment jsdom
/**
 * The paid confirmation carries ONE lead action, and the host decides which.
 *
 * The screen ships one control of its own — "Voltar ao cardápio" — and paints it
 * solid on PAID because for most of this package's life it was the only thing
 * to press. A host that fills `paidExtra` with an action of its own then has two
 * solid buttons side by side and no answer to "what now".
 *
 * Two props settle it, and these cases pin both: `backActionEmphasis` stands the
 * way out down without touching any other outcome, and `paidFooter` gives the
 * host somewhere to put what is merely OFFERED — after the actions, so a panel
 * never lands between the two controls.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentStatus } from "../payment-status";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import { CheckoutComponentsProvider, type CheckoutButtonProps } from "../ui";
import type { OrderStatus } from "../types";

afterEach(cleanup);

/** What the screen ASKED the design system for, keyed by the button's test id. */
type Looks = Record<string, { variant?: string; color?: string }>;

/**
 * A Button slot that records its own props.
 *
 * Asserted here rather than through rendered MUI classes on purpose: the
 * contract this ticket changes is what the package asks a design system for,
 * and a class name is that answer filtered through somebody else's theme.
 */
function recordingButton(looks: Looks) {
  return function RecordedButton({ variant, color, onClick, dataTestId, children }: CheckoutButtonProps) {
    if (dataTestId) looks[dataTestId] = { variant, color };
    return (
      <button type="button" data-testid={dataTestId} onClick={onClick}>
        {children}
      </button>
    );
  };
}

function renderStatus(
  options: {
    status?: OrderStatus;
    backActionEmphasis?: "primary" | "secondary";
    paidExtra?: boolean;
    paidFooter?: boolean;
  } = {},
): Looks {
  const looks: Looks = {};
  render(
    <CheckoutComponentsProvider components={{ Button: recordingButton(looks) }}>
      <PaymentStatus
        copy={PT_BR_CHECKOUT_VIEW_COPY.status}
        status={options.status ?? "PAID"}
        totalLabel="R$ 62,66"
        orderId="6A7B741A"
        onBackToMenu={vi.fn()}
        onRetry={vi.fn()}
        backActionEmphasis={options.backActionEmphasis}
        paidExtra={options.paidExtra ? <div data-testid="host-extra" /> : undefined}
        paidFooter={options.paidFooter ? <div data-testid="host-footer" /> : undefined}
      />
    </CheckoutComponentsProvider>,
  );
  return looks;
}

describe("the way out of a paid confirmation", () => {
  it("leads the screen when the host says nothing — the shipped behaviour", () => {
    const looks = renderStatus();

    expect(looks["payment-back-to-menu"]).toEqual({ variant: "solid", color: "primary" });
  });

  it("stands down when the host leads with an action of its own", () => {
    const looks = renderStatus({ backActionEmphasis: "secondary", paidExtra: true });

    expect(looks["payment-back-to-menu"]).toEqual({ variant: "outline", color: "neutral" });
  });

  it("is unchanged on an unsettled screen, where the retry is the lead anyway", () => {
    const looks = renderStatus({ status: "FAILED", backActionEmphasis: "primary" });

    expect(looks["payment-retry"]).toEqual({ variant: "solid", color: "primary" });
    expect(looks["payment-back-to-menu"]).toEqual({ variant: "outline", color: "neutral" });
  });
});

describe("what the host may put after the actions", () => {
  it("renders the footer BELOW the action row, never between the controls", () => {
    renderStatus({ paidExtra: true, paidFooter: true });

    const extra = screen.getByTestId("host-extra");
    const back = screen.getByTestId("payment-back-to-menu");
    const footer = screen.getByTestId("host-footer");

    // Node.DOCUMENT_POSITION_FOLLOWING === 4: the second node comes after.
    expect(extra.compareDocumentPosition(back) & 4).toBe(4);
    expect(back.compareDocumentPosition(footer) & 4).toBe(4);
  });

  it("draws nothing of it while the payment is unsettled", () => {
    renderStatus({ status: "AWAITING_PAYMENT", paidFooter: true });

    expect(screen.queryAllByTestId("host-footer")).toHaveLength(0);
  });
});
