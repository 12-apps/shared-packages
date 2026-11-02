// @vitest-environment jsdom
/**
 * FUT-4193 — "Salvar meus dados para a próxima compra" keeps the 40px tap floor.
 *
 * The row is one target (the whole label is clickable), so its HEIGHT is the floor.
 * The top variant strips the box's 9px ring to sit flush with the field, which left
 * the row 24px tall; it now gives the label `min-height: 40px` below `sm`
 * (MUI's `down("sm")`, 599.95px) and leaves `sm` and up as they were.
 *
 * jsdom does not lay out, so the rules are read as written, like
 * `payment-list-cpf-look.test.tsx` reads its own.
 */
import { afterEach, describe, expect, it } from "vitest";

import { PaymentListProvider } from "../list/context";
import { CpfTop } from "../list/cpf-top";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import type { CheckoutPaymentList } from "../list/types";
import type { CheckoutCustomerField } from "../types";

import { cleanup, render, screen } from "./test-utils";

afterEach(cleanup);

const COPY = PT_BR_PAYMENT_LIST_COPY.buyer;
const TAX_ID: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };
const LIST = { copy: PT_BR_PAYMENT_LIST_COPY } as CheckoutPaymentList;
const CONSENT = { label: "Salvar meus dados para a próxima compra", checked: false, onChange: () => {} };

function noop(): void {}

function withConsent(children: React.ReactNode) {
  return (
    <PaymentListProvider list={LIST} onLeavePix={noop} consent={CONSENT}>
      {children}
    </PaymentListProvider>
  );
}

/** Every rule emotion wrote, whitespace stripped. */
function css(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n")
    .replace(/\s+/g, "");
}

function rowClass(): string {
  const found = Array.from(screen.getByTestId("list-save-profile-row").classList).find((name) => name.startsWith("css-"));
  if (!found) throw new Error("no emotion class");
  return found;
}

/** The 40px floor, written once, on the label, under the `sm` breakpoint and nowhere else. */
function expectFloorBelowSm(): void {
  const rules = css();
  const floor = ["@media(max-width:599.95px){", `.${rowClass()}`, ".MuiFormControlLabel-root{", "min-height:40px;}}"];
  expect(rules.includes(floor.join(""))).toBe(true);
  // Not set outside the query: the desktop layout is untouched.
  expect(rules.replace(/@media\(max-width:599\.95px\)\{[^}]*\}\}/g, "")).not.toMatch(/MuiFormControlLabel-root\{[^}]*min-height/);
}

describe("the save-my-details row's tap floor (FUT-4193)", () => {
  it("the top variant keeps the label 40px tall below sm, still flush with the field", () => {
    render(withConsent(<CpfTop field={TAX_ID} buyer={{}} onBuyerChange={noop} copy={COPY} provider="PagBank" />));
    expectFloorBelowSm();
    // Flush: the ring is still gone.
    const flush = [`.${rowClass()}`, ".MuiFormControlLabel-root", ".MuiCheckbox-root{", "padding:0px;margin-right:8px;}"];
    expect(css().includes(flush.join(""))).toBe(true);
  });
});
