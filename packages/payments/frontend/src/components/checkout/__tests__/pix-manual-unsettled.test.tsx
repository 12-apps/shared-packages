// @vitest-environment jsdom
/**
 * A Pix only the STORE confirms, ended without a confirmation (FUT-3232).
 *
 * The store answering "Não recebi", or letting its window lapse, proves nothing
 * about the buyer's money: a static key takes a transfer whatever the store
 * later says. So these screens must never claim "Nenhum valor foi cobrado",
 * and must tell a buyer who did pay to talk to the store before paying twice.
 * An automatic Pix keeps its sentences, and so does a host with no `manual`
 * block.
 */
import { describe, expect, it, vi } from "vitest";

import { EN_US_PAYMENT_STATUS_COPY } from "../en-US";
import { PaymentStatus } from "../payment-status";
import { PT_BR_PAYMENT_STATUS_COPY } from "../pt-BR";
import type { OrderStatus } from "../types";
import type { PaymentStatusCopy } from "../view-copy";
import { render, screen } from "./test-utils";

function renderStatus(status: OrderStatus, manual: boolean, copy: PaymentStatusCopy = PT_BR_PAYMENT_STATUS_COPY): void {
  render(
    <PaymentStatus
      copy={copy}
      status={status}
      totalLabel="R$ 24,00"
      onBackToMenu={vi.fn()}
      onRetry={vi.fn()}
      onRegenerate={vi.fn()}
      manual={manual}
    />,
  );
}

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
    renderStatus("FAILED", true, EN_US_PAYMENT_STATUS_COPY);

    expect(screen.getByTestId("payment-failed").textContent).toContain("The store did not find your Pix");
  });

  it("leaves an automatic Pix's screens as they were", () => {
    renderStatus("EXPIRED", false);

    expect(screen.getByTestId("payment-expired").textContent).toContain(PT_BR_PAYMENT_STATUS_COPY.expired.support);
  });

  it("falls back to the ordinary sentences for a host with no manual block", () => {
    renderStatus("FAILED", true, { ...PT_BR_PAYMENT_STATUS_COPY, manual: undefined });

    expect(screen.getByTestId("payment-failed").textContent).toContain(PT_BR_PAYMENT_STATUS_COPY.failed.support);
  });
});
