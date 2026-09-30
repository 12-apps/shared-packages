// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { ClientChargeView } from "@12-apps/payments-backend";

import { PixPanel } from "../../checkout-payment-views";
import type { LegacyPixCopy } from "../../checkout-payment-copy";
import { render, screen } from "./test-utils";

/**
 * The legacy `CheckoutPayment` PIX panel. It used to show a QR only when the
 * provider sent an image URL, so a provider that returns just the BR Code
 * (PagBank, Itau) left the buyer with nothing to scan.
 */

const COPY: LegacyPixCopy = {
  qrAlt: "QR Code PIX",
  copyPasteLabel: "Pix copia e cola",
  copyAction: "Copiar",
  copiedAction: "Copiado",
  awaiting: "Aguardando pagamento",
};

function pixCharge(pix: NonNullable<ClientChargeView["pix"]>): ClientChargeView {
  return {
    provider: "pixbank",
    providerChargeId: "c1",
    status: "PENDING",
    amount: { amountCents: 1000, currency: "BRL" },
    method: "PIX",
    pix,
  } as ClientChargeView;
}

describe("PixPanel", () => {
  it("draws the QR from the BR Code when the provider sent no image", () => {
    render(<PixPanel charge={pixCharge({ qrText: "00020101021226880014br.gov.bcb.pix" })} copy={COPY} />);
    expect(screen.getByTestId("payments-pix-qr-local").querySelector("svg")).toBeTruthy();
  });

  it("shows the provider's own image when it sent one", () => {
    render(
      <PixPanel
        charge={pixCharge({ qrText: "00020101021226880014br.gov.bcb.pix", qrImageUrl: "data:image/png;base64,AA==" })}
        copy={COPY}
      />,
    );
    expect(screen.getByRole("img", { name: "QR Code PIX" }).getAttribute("src")).toBe("data:image/png;base64,AA==");
  });
});
