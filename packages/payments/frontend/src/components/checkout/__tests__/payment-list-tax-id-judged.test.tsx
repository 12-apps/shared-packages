// @vitest-environment jsdom
/**
 * FUT-4106 — the document at the top of Pagamento is not red while it is
 * being typed.
 *
 *  - While the field is focused, nothing under 14 digits is red: a CPF or a
 *    CNPJ on its way is not a mistake yet.
 *  - It is judged when the buyer leaves the field, at 14 digits, or when an
 *    11- or 14-digit value arrives in one change (a paste, an autofill).
 *    Several digits at once that make neither length are not a trigger.
 *  - Eleven digits typed one by one are not a trigger: a CNPJ's first eleven
 *    are usually not a valid CPF.
 *  - A complete value set in one go is judged at once — valid clears, invalid
 *    complains — so a paste or a fill still recovers the field.
 *  - FUT-4080's focus advance is untouched: a CNPJ typed to its 14th digit
 *    moves the buyer on.
 */
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CpfTop, taxIdJudged } from "../list/cpf-top";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import type { BuyerInfo, CheckoutCustomerField } from "../types";

import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";

afterEach(cleanup);

const COPY = PT_BR_PAYMENT_LIST_COPY.buyer;
const TAX_ID: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };

const INCOMPLETE = "O CPF tem 11 dígitos, e o CNPJ, 14.";
const INVALID = "Informe um CPF ou CNPJ válido.";

const VALID_CPF = "52998224725";
const INVALID_CPF = "52998224700";
const VALID_CNPJ = "11222333000181";
const INVALID_CNPJ = "11222333000182";

function Document({ initial = "", onComplete }: { initial?: string; onComplete?: () => void }): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({ taxId: initial });
  return <CpfTop field={TAX_ID} buyer={buyer} onBuyerChange={setBuyer} copy={COPY} provider="PagBank" onComplete={onComplete} />;
}

function input(): HTMLInputElement {
  return screen.getByTestId("list-buyer-taxId") as HTMLInputElement;
}

/** The sentence under the field, or `null` when it says nothing. */
function complaint(): string | null {
  return screen.getByTestId("list-cpf").querySelector(".MuiFormHelperText-root")?.textContent ?? null;
}

function red(): boolean {
  return input().getAttribute("aria-invalid") === "true";
}

/** The buyer enters the field: React's `onFocus` listens for `focusin`. */
function enter(): void {
  fireEvent.focusIn(input());
}

/** The buyer leaves it: React's `onBlur` listens for `focusout`. */
function leave(): void {
  fireEvent.focusOut(input());
}

function type(value: string): void {
  fireEvent.change(input(), { target: { value } });
}

/** Every value a buyer typing `digits` one keystroke at a time passes through. */
function prefixesOf(digits: string): string[] {
  return Array.from(digits, (_digit, index) => digits.slice(0, index + 1));
}

/** Type `digits` one keystroke at a time, the way a buyer does. */
function typeDigitByDigit(digits: string): void {
  prefixesOf(digits).forEach(type);
}

describe("taxIdJudged", () => {
  it.each([
    [{ focused: false, digits: 3, arrivedWhole: false }, true],
    [{ focused: true, digits: 3, arrivedWhole: false }, false],
    [{ focused: true, digits: 11, arrivedWhole: false }, false],
    [{ focused: true, digits: 13, arrivedWhole: true }, false],
    [{ focused: true, digits: 4, arrivedWhole: true }, false],
    [{ focused: true, digits: 11, arrivedWhole: true }, true],
    [{ focused: true, digits: 14, arrivedWhole: false }, true],
    [{ focused: true, digits: 14, arrivedWhole: true }, true],
  ])("judges %o: %s", (state, judged) => {
    expect(taxIdJudged(state)).toBe(judged);
  });
});

describe("the document while it is typed (FUT-4106)", () => {
  it.each(prefixesOf(INVALID_CNPJ.slice(0, 13)))("is not red at %s while focused", async (typed) => {
    render(<Document />);
    enter();
    typeDigitByDigit(typed);
    await waitFor(() => expect(complaint()).toBeNull());
    expect(red()).toBe(false);
  });

  it("does not judge eleven digits typed one by one, even when they are no valid CPF", async () => {
    render(<Document />);
    enter();
    typeDigitByDigit(INVALID_CPF);
    await waitFor(() => expect(complaint()).toBeNull());
    expect(red()).toBe(false);
  });

  it("judges a CNPJ at its 14th digit while focused", async () => {
    render(<Document />);
    enter();
    typeDigitByDigit(INVALID_CNPJ);
    await waitFor(() => expect(complaint()).toBe(INVALID));
    expect(red()).toBe(true);
  });

  it("judges a short value once the buyer leaves the field", async () => {
    render(<Document />);
    enter();
    typeDigitByDigit("123");
    await waitFor(() => expect(complaint()).toBeNull());
    leave();
    await waitFor(() => expect(complaint()).toBe(INCOMPLETE));
    expect(red()).toBe(true);
  });

  it("judges an invalid CPF typed one by one once the buyer leaves the field", async () => {
    render(<Document />);
    enter();
    typeDigitByDigit(INVALID_CPF);
    leave();
    await waitFor(() => expect(complaint()).toBe(INVALID));
  });

  it("stops being red when the buyer comes back and types on", async () => {
    render(<Document />);
    enter();
    typeDigitByDigit("123");
    leave();
    await waitFor(() => expect(complaint()).toBe(INCOMPLETE));
    enter();
    type("1234");
    await waitFor(() => expect(complaint()).toBeNull());
    expect(red()).toBe(false);
  });

  it.each(["1234", "123456789012"])("does not judge %s arriving at once, short of either length", async (pasted) => {
    render(<Document />);
    enter();
    type(pasted);
    await waitFor(() => expect(complaint()).toBeNull());
    expect(red()).toBe(false);
  });
});

describe("a whole document set in one go (FUT-4106)", () => {
  it.each([
    ["an invalid CPF", INVALID_CPF],
    ["an invalid CNPJ", INVALID_CNPJ],
  ])("judges %s pasted into the focused field at once", async (_case, pasted) => {
    render(<Document />);
    enter();
    type(pasted);
    await waitFor(() => expect(complaint()).toBe(INVALID));
    expect(red()).toBe(true);
  });

  it.each([
    ["a valid CPF", VALID_CPF],
    ["a valid CNPJ", VALID_CNPJ],
  ])("says nothing for %s pasted into the focused field", async (_case, pasted) => {
    render(<Document />);
    enter();
    type(pasted);
    await waitFor(() => expect(complaint()).toBeNull());
    expect(red()).toBe(false);
  });

  it("recovers when a valid document is pasted over an invalid one", async () => {
    render(<Document />);
    enter();
    type(INVALID_CPF);
    await waitFor(() => expect(complaint()).toBe(INVALID));
    type("");
    type(VALID_CPF);
    await waitFor(() => expect(complaint()).toBeNull());
    expect(red()).toBe(false);
  });

  it("judges a value an autofill sets while the buyer is elsewhere", async () => {
    render(<Document />);
    type("123");
    await waitFor(() => expect(complaint()).toBe(INCOMPLETE));
    type(VALID_CPF);
    await waitFor(() => expect(complaint()).toBeNull());
  });

  it("judges a short document the host hands over as it opens", () => {
    render(<Document initial="123" />);
    expect(complaint()).toBe(INCOMPLETE);
  });
});

describe("the focus advance under the deferred judgment (FUT-4080)", () => {
  it("still moves the buyer on at a valid CNPJ's 14th typed digit", async () => {
    const onComplete = vi.fn();
    render(<Document onComplete={onComplete} />);
    enter();
    typeDigitByDigit(VALID_CNPJ);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(complaint()).toBeNull();
  });

  it("still moves the buyer on when a valid CPF is pasted whole", async () => {
    const onComplete = vi.fn();
    render(<Document onComplete={onComplete} />);
    enter();
    type(VALID_CPF);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
