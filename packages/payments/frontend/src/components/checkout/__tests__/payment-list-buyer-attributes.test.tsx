// @vitest-environment jsdom
/**
 * FUT-4104, FUT-4105 — the buyer fields say what they hold on the `<input>`.
 *
 *  - The e-mail renders `type="email"` (a phone's keyboard shows `@`), the
 *    phone `type="tel"`.
 *  - Name, e-mail and phone carry the autocomplete tokens `name`, `email` and
 *    `tel`, so the browser offers the saved value.
 *  - The document at the top of Pagamento has a stable `name` (`taxId`) and
 *    id, and no `autocomplete="off"`: HTML has no token for a CPF or a CNPJ,
 *    and the `name` is what a form history or a password manager matches.
 *
 * Read off the rendered DOM, not the props: a prop the slot drops never
 * reaches the browser.
 */
import { afterEach, describe, expect, it } from "vitest";

import { BuyerInline } from "../list/buyer-inline";
import { CpfTop } from "../list/cpf-top";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import type { CheckoutCustomerField } from "../types";

import { cleanup, render, screen } from "./test-utils";

afterEach(cleanup);

const COPY = PT_BR_PAYMENT_LIST_COPY.buyer;

const ASKED: CheckoutCustomerField[] = [
  { key: "name", type: "NAME", required: true },
  { key: "email", type: "EMAIL", required: true },
  { key: "phone", type: "MOBILE", required: true },
];

const TAX_ID: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };

function inputOf(testId: string): HTMLInputElement {
  const node = screen.getByTestId(testId);
  return (node.tagName === "INPUT" ? node : node.querySelector("input")) as HTMLInputElement;
}

/** The attributes that say what a field holds, read off its `<input>`. */
function attributesOf(testId: string): Record<"type" | "name" | "id" | "autocomplete", string | null> {
  const node = inputOf(testId);
  return {
    type: node.getAttribute("type"),
    name: node.getAttribute("name"),
    id: node.getAttribute("id"),
    autocomplete: node.getAttribute("autocomplete"),
  };
}

function noop(): void {}

describe("the buyer details asked inside an option (FUT-4104, FUT-4105)", () => {
  it.each([
    ["name", "text", "name"],
    ["email", "email", "email"],
    ["phone", "tel", "tel"],
  ])("renders the %s field with type %s and autocomplete %s on its <input>", (key, type, token) => {
    render(<BuyerInline asked={ASKED} buyer={{}} onBuyerChange={noop} copy={COPY} provider="PagBank" />);
    expect(inputOf(`list-buyer-${key}`).tagName).toBe("INPUT");
    expect(attributesOf(`list-buyer-${key}`)).toEqual({ type, name: key, id: `checkout-buyer-${key}`, autocomplete: token });
  });

  it("gives its own document branch the same name and id as the top's, and no autocomplete", () => {
    render(<BuyerInline asked={[TAX_ID]} buyer={{}} onBuyerChange={noop} copy={COPY} provider="PagBank" />);
    expect(attributesOf("list-buyer-taxId")).toEqual({ type: "text", name: "taxId", id: "checkout-buyer-taxId", autocomplete: null });
  });
});

describe("the document at the top of Pagamento (FUT-4105)", () => {
  it("has a stable name and id, and no autocomplete='off'", () => {
    render(<CpfTop field={TAX_ID} buyer={{}} onBuyerChange={noop} copy={COPY} provider="PagBank" />);
    const { autocomplete, ...said } = attributesOf("list-buyer-taxId");
    expect(said).toEqual({ type: "text", name: "taxId", id: "checkout-buyer-taxId" });
    expect(autocomplete).not.toBe("off");
  });

  it("keeps the same id across renders, not a generated one", () => {
    const first = render(<CpfTop field={TAX_ID} buyer={{}} onBuyerChange={noop} copy={COPY} provider="PagBank" />);
    const id = inputOf("list-buyer-taxId").getAttribute("id");
    first.unmount();
    render(<CpfTop field={TAX_ID} buyer={{}} onBuyerChange={noop} copy={COPY} provider="PagBank" />);
    expect(inputOf("list-buyer-taxId").getAttribute("id")).toBe(id);
    expect(id).not.toMatch(/_r_|:r/);
  });
});
