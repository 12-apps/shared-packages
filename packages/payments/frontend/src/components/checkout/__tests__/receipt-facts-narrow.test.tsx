// @vitest-environment jsdom
/**
 * FUT-3693, UI review — "Comprovante enviado para <e-mail>" on a 390px phone:
 * side by side, the e-mail broke mid-word and squeezed the label into three
 * lines. On every lane that shows the paid confirmation (the receipt is this
 * package's), the e-mail now stands UNDER its label once the receipt's own
 * width is under `RECEIPT_STACK_BELOW_PX`, and its value may break anywhere
 * rather than widen the receipt. The amount and the order keep their row.
 *
 * jsdom evaluates no `@container` query, so the rule is read as CSS text,
 * whole; the picture at 390px is the UI review's.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentStatus } from "../payment-status";
import { RECEIPT_STACK_BELOW_PX } from "../payment-status-parts";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";

afterEach(cleanup);

function styleText(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n")
    .replace(/\s+/g, "");
}

function emotionClass(element: Element): string {
  const found = Array.from(element.classList).find((name) => name.startsWith("css-"));
  if (!found) throw new Error("no emotion class");
  return found;
}

function renderPaid(): void {
  render(
    <PaymentStatus
      copy={PT_BR_CHECKOUT_VIEW_COPY.status}
      status="PAID"
      totalLabel="R$ 6,00"
      orderId="0d623625-aaaa-bbbb-cccc-000000000000"
      buyerEmail="e4card390-um-endereco-bem-comprido@futurepay.test"
      onBackToMenu={vi.fn()}
    />,
  );
}

describe("the paid receipt at a narrow width", () => {
  it("is the container its facts are laid out against", () => {
    renderPaid();
    const receipt = screen.getByTestId("payment-receipt");
    expect(getComputedStyle(receipt).getPropertyValue("container-type")).toBe("inline-size");
    expect(styleText()).toContain(`.${emotionClass(receipt)}{container-type:inline-size;container-name:receipt;`);
  });

  it("stacks the e-mail under its label, left-aligned, under the threshold", () => {
    renderPaid();
    const css = styleText();
    const row = screen.getByTestId("payment-receipt-email-row");
    const value = screen.getByTestId("payment-receipt-email").parentElement as HTMLElement;
    const query = `@containerreceipt(max-width:${RECEIPT_STACK_BELOW_PX - 0.05}px)`;
    // Emotion prefixes the flex declarations; the unprefixed ones are read inside the rule.
    const stacked = css.match(new RegExp(`${query.replace(/[().]/g, "\\$&")}\\{\\.${emotionClass(row)}\\{([^}]*)\\}`))?.[1] ?? "";
    expect(stacked).toMatch(/(^|;)flex-direction:column;/);
    expect(stacked).toMatch(/(^|;)align-items:flex-start;/);
    expect(css).toContain(`${query}{.${emotionClass(value)}{text-align:left;}}`);
    // The value breaks inside its own box rather than widening the receipt.
    expect(getComputedStyle(value).getPropertyValue("overflow-wrap")).toBe("anywhere");
    expect(getComputedStyle(value).getPropertyValue("min-width")).toBe("0");
  });

  it("never lets the label give way to the value", () => {
    renderPaid();
    const label = screen.getByText(PT_BR_CHECKOUT_VIEW_COPY.status.receiptEmailLabel).parentElement as HTMLElement;
    expect(getComputedStyle(label).getPropertyValue("flex-shrink")).toBe("0");
  });

  it("keeps the amount and the order on one row: only the e-mail stacks", () => {
    renderPaid();
    const css = styleText();
    for (const id of ["payment-amount-row", "payment-reference-row"]) {
      const cls = emotionClass(screen.getByTestId(id));
      expect(css.includes(`{.${cls}{flex-direction:column`)).toBe(false);
    }
  });
});
