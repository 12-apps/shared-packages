// @vitest-environment jsdom
/**
 * FUT-590 — the CPF-or-CNPJ field's keyboard, as the owner approved it
 * (option B, 2026-10-28).
 *
 *  - The field opens the NUMBER keyboard, in a host binding too. `@12-apps/ui`'s
 *    `Input` puts a top-level `inputMode` on its root `<div>` (FUT-1440), so the
 *    package also hands the keyboard over in `inputProps`, which every binding
 *    merges onto the `<input>`.
 *  - On a phone, a quiet link under the field — "Seu CNPJ tem letras? Usar
 *    teclado com letras" — switches it to the letters keyboard, and "Voltar ao
 *    teclado de números" switches it back. Each tap leaves the buyer in the
 *    field, so the new keyboard is the one that opens.
 *  - On a computer the link is not drawn: the physical keyboard already has
 *    letters.
 *  - A pack without the two sentences keeps the field as it was.
 *  - A document that fails its check digits says "Esse CPF ou CNPJ não é
 *    válido. Confira os números." under the field.
 */
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuyerInline } from "../list/buyer-inline";
import { CpfTop } from "../list/cpf-top";
import { EN_US_PAYMENT_LIST_COPY } from "../list/en-US";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import type { PaymentListCopy } from "../list/types";
import type { BuyerInfo, CheckoutCustomerField } from "../types";
import { CheckoutComponentsProvider, type CheckoutInputProps } from "../ui";

import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const COPY = PT_BR_PAYMENT_LIST_COPY.buyer;
const TAX_ID: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };

const TO_LETTERS = "Seu CNPJ tem letras? Usar teclado com letras";
const TO_NUMBERS = "Voltar ao teclado de números";
const INVALID = "Esse CPF ou CNPJ não é válido. Confira os números.";

/**
 * A binding shaped like `@12-apps/ui`'s `Input` up to FUT-1440: anything it
 * does not name lands on the root `<div>`, and only `inputProps` reaches the
 * `<input>` — merged, so the field's own attributes survive.
 */
function UiLikeInput({ value, onChange, onFocus, onBlur, inputProps, helperText, error, placeholder, type, id, name, "data-testid": testId, ...rest }: CheckoutInputProps): JSX.Element {
  const { inputMode, autoComplete } = rest;
  return (
    <div data-testid="ui-root" {...(inputMode === undefined ? {} : { inputmode: inputMode })}>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? "true" : undefined}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        data-testid={testId}
        {...inputProps}
      />
      {helperText ? <p>{helperText}</p> : null}
    </div>
  );
}

/** A computer: the pointer is a mouse that hovers. Anything else is a phone or a tablet. */
function onAComputer(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function Top({ copy = COPY }: { copy?: PaymentListCopy["buyer"] }): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({ taxId: "" });
  return <CpfTop field={TAX_ID} buyer={buyer} onBuyerChange={setBuyer} copy={copy} provider="PagBank" />;
}

function Inline(): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({ taxId: "" });
  return <BuyerInline asked={[TAX_ID]} buyer={buyer} onBuyerChange={setBuyer} copy={COPY} provider="PagBank" withConsent={false} />;
}

function input(): HTMLInputElement {
  return screen.getByTestId("list-buyer-taxId") as HTMLInputElement;
}

function link(): HTMLElement {
  return screen.getByTestId("list-cpf-keyboard");
}

describe.each([
  ["the top of Pagamento", Top],
  ["the option's own fields", Inline],
])("the document's keyboard at %s", (_where, Field) => {
  it("opens the number keyboard by default", () => {
    render(<Field />);
    expect(input().getAttribute("inputmode")).toBe("numeric");
  });

  it("opens the number keyboard in a binding that only merges inputProps onto the <input>", () => {
    render(
      <CheckoutComponentsProvider components={{ Input: UiLikeInput }}>
        <Field />
      </CheckoutComponentsProvider>,
    );
    expect(input().getAttribute("inputmode")).toBe("numeric");
  });

  it("offers the letters keyboard on a phone, and the number keyboard back", () => {
    render(<Field />);
    expect(link().textContent).toContain(TO_LETTERS);

    fireEvent.click(link());
    expect(input().getAttribute("inputmode")).toBe("text");
    expect(link().textContent).toContain(TO_NUMBERS);

    fireEvent.click(link());
    expect(input().getAttribute("inputmode")).toBe("numeric");
    expect(link().textContent).toContain(TO_LETTERS);
  });

  it("switches the keyboard in a binding that only merges inputProps onto the <input>", () => {
    render(
      <CheckoutComponentsProvider components={{ Input: UiLikeInput }}>
        <Field />
      </CheckoutComponentsProvider>,
    );
    fireEvent.click(link());
    expect(input().getAttribute("inputmode")).toBe("text");
  });

  it("leaves the buyer in the field after the switch, so the new keyboard is the one that opens", async () => {
    render(<Field />);
    fireEvent.click(link());
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it("does not draw the link on a computer, whose keyboard already has letters", async () => {
    onAComputer();
    render(<Field />);
    expect(input().getAttribute("inputmode")).toBe("numeric");
    await waitFor(() => expect(screen.queryByTestId("list-cpf-keyboard")).toBeNull());
    expect(document.body.textContent ?? "").not.toContain(TO_LETTERS);
  });
});

describe("the document's keyboard link and its words", () => {
  it("is not drawn for a pack that has no words for it", async () => {
    const older: PaymentListCopy["buyer"] = { ...COPY, lettersKeyboard: undefined, numbersKeyboard: undefined };
    render(<Top copy={older} />);
    expect(input().getAttribute("inputmode")).toBe("numeric");
    await waitFor(() => expect(screen.queryByTestId("list-cpf-keyboard")).toBeNull());
  });

  it("speaks English in the en-US pack", () => {
    expect(EN_US_PAYMENT_LIST_COPY.buyer.lettersKeyboard).toBe("Does your CNPJ have letters? Use the letters keyboard");
    expect(EN_US_PAYMENT_LIST_COPY.buyer.numbersKeyboard).toBe("Back to the number keyboard");
  });
});

describe("a document that fails its check digits", () => {
  it.each([
    ["the repeated-digit CPF", "11111111111"],
    ["a CPF with wrong check digits", "12345678900"],
    ["a CNPJ with wrong check digits", "11222333000182"],
  ])("says so under the field for %s", (_case, digits) => {
    render(<Top />);
    fireEvent.change(input(), { target: { value: digits } });
    fireEvent.focusOut(input());
    expect(screen.getByTestId("list-cpf").textContent).toContain(INVALID);
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });
});
