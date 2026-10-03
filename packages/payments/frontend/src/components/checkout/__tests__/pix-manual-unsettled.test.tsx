// @vitest-environment jsdom
/**
 * A Pix only the STORE confirms, ended without a confirmation (FUT-3232).
 *
 * The store answering "Não recebi", or letting its window lapse, proves nothing
 * about the buyer's money: a static key takes a transfer whatever the store
 * later says. So these screens must never claim "Nenhum valor foi cobrado",
 * must tell a buyer who did pay to talk to the store before paying twice, and
 * must not paint "pay again" as the thing to do. An automatic Pix keeps its
 * sentences and its buttons, and so does a host with no `manual` block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX, ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { CheckoutFlow } from "../checkout-flow";
import { EN_US_PAYMENT_STATUS_COPY } from "../en-US";
import { PaymentStatus } from "../payment-status";
import { PT_BR_CHECKOUT_VIEW_COPY, PT_BR_PAYMENT_STATUS_COPY } from "../pt-BR";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, CreateOrderResult, OrderStatus } from "../types";
import { CheckoutComponentsProvider, type CheckoutButtonProps } from "../ui";
import type { PaymentStatusCopy } from "../view-copy";
import type { CheckoutDecline } from "../decline";
import { act, cleanup, fireEvent, render, screen } from "./test-utils";

/** What the screen asked the design system for, keyed by the button's test id. */
type Looks = Record<string, { variant?: string; color?: string }>;

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
  status: OrderStatus,
  manual: boolean,
  options: { copy?: PaymentStatusCopy; decline?: CheckoutDecline } = {},
): Looks {
  const looks: Looks = {};
  render(
    <CheckoutComponentsProvider components={{ Button: recordingButton(looks) }}>
      <PaymentStatus
        copy={options.copy ?? PT_BR_PAYMENT_STATUS_COPY}
        status={status}
        totalLabel="R$ 24,00"
        onBackToMenu={vi.fn()}
        onRetry={vi.fn()}
        onRegenerate={vi.fn()}
        decline={options.decline}
        manual={manual}
      />
    </CheckoutComponentsProvider>,
  );
  return looks;
}

afterEach(() => {
  cleanup();
});

describe("a Pix the store confirms, ended unconfirmed", () => {
  it("says the store did not find it, never that nothing was charged", () => {
    renderStatus("FAILED", true);

    const pane = screen.getByTestId("payment-failed");
    expect(pane.textContent).toContain("A loja não identificou o seu Pix");
    expect(pane.textContent).toContain("Se você já pagou, fale com a loja antes de pagar de novo.");
    expect(pane.textContent).not.toContain("Nenhum valor foi cobrado");
  });

  it("says the store did not confirm in time when the window lapsed", () => {
    renderStatus("EXPIRED", true);

    const pane = screen.getByTestId("payment-expired");
    expect(pane.textContent).toContain("A loja não confirmou o pagamento a tempo");
    expect(pane.textContent).not.toContain("Nenhum valor foi cobrado");
  });

  it("says it in the other language too", () => {
    renderStatus("EXPIRED", true, { copy: EN_US_PAYMENT_STATUS_COPY });

    expect(screen.getByTestId("payment-expired").textContent).toContain(
      "The store did not confirm the payment in time",
    );
  });

  it("keeps its own sentence even when a decline reason came with it", () => {
    renderStatus("FAILED", true, { decline: { reason: "PROVIDER_ERROR" } });

    expect(screen.getByTestId("payment-failed").textContent).toContain("A loja não identificou o seu Pix");
  });

  it("offers paying again only as a step back, never as the lead", () => {
    const failed = renderStatus("FAILED", true);
    cleanup();
    const expired = renderStatus("EXPIRED", true);

    expect(failed["payment-retry"]).toEqual({ variant: "outline", color: "neutral" });
    expect(expired["payment-regenerate"]).toEqual({ variant: "outline", color: "neutral" });
  });
});

describe("everything else keeps its screen", () => {
  it("leaves an automatic Pix's sentences and buttons as they were", () => {
    const failed = renderStatus("FAILED", false);

    expect(screen.getByTestId("payment-failed").textContent).toContain(PT_BR_PAYMENT_STATUS_COPY.failed.support);
    expect(failed["payment-retry"]).toEqual({ variant: "solid", color: "primary" });
    cleanup();

    renderStatus("EXPIRED", false);
    expect(screen.getByTestId("payment-expired").textContent).toContain(PT_BR_PAYMENT_STATUS_COPY.expired.support);
  });

  it("falls back to the ordinary sentences for a host with no manual block", () => {
    renderStatus("FAILED", true, { copy: { ...PT_BR_PAYMENT_STATUS_COPY, manual: undefined } });

    expect(screen.getByTestId("payment-failed").textContent).toContain(PT_BR_PAYMENT_STATUS_COPY.failed.support);
  });
});

/** A fixed instant, so the code's expiry is the same span on every run. */
const NOW = new Date("2026-10-02T12:00:00.000Z").getTime();

/** One store raising a MANUAL Pix and answering its status from a slot the test writes. */
function manualPixServer(): {
  client: CheckoutClient;
  createOrder: () => Promise<CreateOrderResult>;
  answer: (status: OrderStatus) => void;
} {
  const state: { status: OrderStatus } = { status: "AWAITING_PAYMENT" };
  const order: CheckoutOrder = {
    orderId: "o-manual",
    status: "AWAITING_PAYMENT",
    method: "PIX",
    totalCents: 2400,
    subtotalCents: 2400,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: "R$ 24,00",
    pix: {
      copyPaste: "00020126BR.GOV.BCB.PIX",
      expiresAt: new Date(NOW + 30 * 60_000).toISOString(),
      confirmation: "MANUAL",
    },
  };
  const client = {
    getStatus: async () => ({ ok: true as const, data: state.status }),
  } as unknown as CheckoutClient;
  return {
    client,
    createOrder: async () => ({ ok: true, data: order }),
    answer: (status) => {
      state.status = status;
    },
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

describe("the checkout flow, end to end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // A raised order is parked in `sessionStorage`; these suites share one tab.
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries the order's MANUAL confirmation onto the screen the store's refusal lands on", async () => {
    const server = manualPixServer();
    render(
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 24,00", totalItems: 1 }}
        createOrder={server.createOrder}
        onExitToMenu={vi.fn()}
        taxIdOnFile
      />,
      { wrapper: withClient(server.client) },
    );
    fireEvent.click(screen.getByTestId("checkout-method-PIX"));
    await elapse(0);
    expect(screen.getByTestId("pix-view")).toBeTruthy();

    server.answer("FAILED");
    await elapse(30_000);

    expect(screen.getByTestId("payment-failed").textContent).toContain("A loja não identificou o seu Pix");
  });
});
