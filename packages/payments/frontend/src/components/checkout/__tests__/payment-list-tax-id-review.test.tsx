// @vitest-environment jsdom
/**
 * FUT-590, UI review of the document field.
 *
 *  - A finger can hit both quiet links — "Seu CNPJ tem letras?" and "Manter o
 *    documento salvo": each is a 40px target, its extra height taken back by
 *    negative margins so the text stays where it sat.
 *  - A document pasted with its label — "CPF 529.982.247-25", "CNPJ:
 *    11.222.333/0001-81" — keeps the document, not the label's letters.
 *  - The phone is told not to spell-check, autocorrect or lower-case it: a
 *    CNPJ's `01DE` is no word.
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatCpfOrCnpj, taxIdInput } from "../../../card";
import { BuyerInline } from "../list/buyer-inline";
import { CpfTop } from "../list/cpf-top";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import type { BuyerInfo, CheckoutCustomerField } from "../types";

import { PASTE_CORPUS } from "./tax-id-paste-corpus";
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const COPY = PT_BR_PAYMENT_LIST_COPY.buyer;
const TAX_ID: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };

function Field({ onKeepSaved, kept = [] }: { onKeepSaved?: () => void; kept?: BuyerInfo[] }): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({ taxId: "" });
  return (
    <CpfTop
      field={TAX_ID}
      buyer={buyer}
      onBuyerChange={(next) => {
        kept.push(next);
        setBuyer(next);
      }}
      copy={COPY}
      provider="PagBank"
      onKeepSaved={onKeepSaved}
    />
  );
}

function input(): HTMLInputElement {
  return screen.getByTestId("list-buyer-taxId") as HTMLInputElement;
}

describe("the quiet links under the document field", () => {
  it("are each a 40px target that never overlaps the next, their text kept in place", () => {
    render(<Field onKeepSaved={() => undefined} />);
    for (const testId of ["list-cpf-keyboard", "list-cpf-keep"]) {
      const button = screen.getByTestId(testId);
      expect(getComputedStyle(button).minHeight, testId).toBe("40px");
      // Half the extra 16px above keeps the text in place; giving back only
      // 4px below leaves the next band, 12px away, touching but not overlapping.
      const band = screen.getByTestId(`${testId}-band`);
      expect(getComputedStyle(band).marginTop, testId).toBe("-8px");
      expect(getComputedStyle(band).marginBottom, testId).toBe("-4px");
    }
    expect(getComputedStyle(screen.getByTestId("list-cpf")).getPropertyValue("gap")).toBe("12px");
  });
});

describe("a document pasted with its label", () => {
  it.each(PASTE_CORPUS)("%j keeps %j", (pasted, kept) => {
    const shown = formatCpfOrCnpj(kept);
    const buyers: BuyerInfo[] = [];
    render(<Field kept={buyers} />);
    fireEvent.change(input(), { target: { value: pasted } });
    expect(input().value).toBe(shown);
    expect(buyers.at(-1)?.taxId).toBe(kept);
  });

  it("reads a label-led paste by its digits, unless a whole alphanumeric CNPJ is there", () => {
    expect(taxIdInput("CPF 529.982.247-25")).toBe("52998224725");
    expect(taxIdInput("  cpf :  529.982.247-25")).toBe("52998224725");
    // A glued label is a paste: a valid alphanumeric CNPJ beginning CPF keeps its letters,
    // anything less follows the digits-only field.
    expect(taxIdInput("CPF12345678944")).toBe("CPF12345678944");
    expect(taxIdInput("CPF12ABC34501")).toBe("1234501");
    expect(taxIdInput("CPF 529.982.247-25 Fulano de Tal")).toBe("52998224725");
    // Typing, no label: a CNPJ whose first eleven digits are a valid CPF keeps its twelfth.
    expect(taxIdInput("112.223.550-001")).toBe("112223550001");
    expect(taxIdInput("CNPJ n° 11.222.333/0001-81")).toBe("11222333000181");
    expect(taxIdInput("CNPJ No. 11.222.333/0001-81")).toBe("11222333000181");
    // A run must START with CPF or CNPJ: a masked alphanumeric CNPJ may begin MF. or NO.
    expect(taxIdInput("MF.ABC.345/01DE-35")).toBe("MFABC34501DE35");
    expect(taxIdInput("NO.ABC.345/01DE-35")).toBe("NOABC34501DE35");
  });
});

describe("what the phone's keyboard is told about the document", () => {
  it("no spell-check, no autocorrect, capitals", () => {
    render(<Field />);
    expect(input().getAttribute("spellcheck")).toBe("false");
    expect(input().getAttribute("autocorrect")).toBe("off");
    expect(input().getAttribute("autocapitalize")).toBe("characters");
  });
});

describe("a document that arrives with a letter", () => {
  it("moves the field to the letters keyboard by itself, and the link offers the way back", () => {
    render(<Field />);
    expect(input().getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(input(), { target: { value: "12.ABC.345/01DE-35" } });
    expect(input().getAttribute("inputmode")).toBe("text");
    expect(screen.getByTestId("list-cpf-keyboard").textContent).toContain("Voltar ao teclado de números");
  });

  it("keeps the buyer's own choice of numbers while the letters stay", () => {
    render(<Field />);
    fireEvent.change(input(), { target: { value: "12.ABC.345/01DE-35" } });
    fireEvent.click(screen.getByTestId("list-cpf-keyboard"));
    expect(input().getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(input(), { target: { value: "12.ABC.345/01DE-3" } });
    expect(input().getAttribute("inputmode")).toBe("numeric");
  });

  it("opens on the letters keyboard over a document on file that carries a letter", () => {
    function OnFile(): JSX.Element {
      const [buyer, setBuyer] = useState<BuyerInfo>({ taxId: "12ABC34501DE35" });
      return <CpfTop field={TAX_ID} buyer={buyer} onBuyerChange={setBuyer} copy={COPY} provider="PagBank" />;
    }
    render(<OnFile />);
    expect(input().getAttribute("inputmode")).toBe("text");
  });
});

/**
 * Record, ON the document field, the `inputmode` it had each time it took the
 * focus: `data-focused-with="numeric text"`. Kept on the element rather than
 * in a test variable, so nothing is shared between cases.
 */
function recordInputModeAtFocus(): void {
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (this.getAttribute("data-testid") === "list-buyer-taxId") {
      const before = this.getAttribute("data-focused-with");
      this.setAttribute("data-focused-with", [before, this.getAttribute("inputmode")].filter(Boolean).join(" "));
    }
    focus.call(this, options);
  });
}

function FocusedOnOpen({ taxId }: { taxId: string }): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({ taxId });
  return <CpfTop field={TAX_ID} buyer={buyer} onBuyerChange={setBuyer} copy={COPY} provider="PagBank" focusOnMount onKeepSaved={() => undefined} />;
}

/** Put the buyer in an element, as a host's own code does (not a test interaction). */
function enter(element: HTMLElement | null | undefined): void {
  if (element) HTMLElement.prototype.focus.call(element);
}

/** The card option of the list: the document is the last field before "Número do cartão". */
function CardChosen(): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({ taxId: "" });
  const card = useRef<HTMLInputElement | null>(null);
  const scope = useRef<HTMLDivElement | null>(null);
  useEffect(() => enter(scope.current?.querySelector<HTMLInputElement>('[data-testid="list-buyer-taxId"]')), []);
  return (
    <div ref={scope}>
      <BuyerInline asked={[TAX_ID]} buyer={buyer} onBuyerChange={setBuyer} copy={COPY} provider="PagBank" withConsent={false} onComplete={() => enter(card.current)} />
      <input ref={card} data-testid="card-number" aria-label="Número do cartão" />
    </div>
  );
}

describe("the keyboard a phone reads as the field takes the focus", () => {
  it("re-enters a focused field when a pasted letter switches it, so the keypad is the letters one", async () => {
    recordInputModeAtFocus();
    render(<FocusedOnOpen taxId="" />);
    await waitFor(() => expect(input().getAttribute("data-focused-with")).toBe("numeric"));
    fireEvent.change(input(), { target: { value: "12.ABC.345/01DE-35" } });
    await waitFor(() => expect(input().getAttribute("data-focused-with")).toBe("numeric text"));
    await waitFor(() => expect(input()).toBe(document.activeElement));
  });

  it("does not grab the focus when the letter arrives in a field the buyer is not in", () => {
    recordInputModeAtFocus();
    render(<Field />);
    fireEvent.change(input(), { target: { value: "12.ABC.345/01DE-35" } });
    expect(input().getAttribute("inputmode")).toBe("text");
    expect(input().getAttribute("data-focused-with")).toBeNull();
  });

  it("opened by Alterar over a document with letters, is focused with the letters keyboard already set", async () => {
    recordInputModeAtFocus();
    render(<FocusedOnOpen taxId="12ABC34501DE35" />);
    await waitFor(() => expect(input().getAttribute("data-focused-with")).toBe("text"));
  });

  it("does not pull the buyer back once a completed document moved them on to the card number", async () => {
    render(<CardChosen />);
    await waitFor(() => expect(input()).toBe(document.activeElement));
    fireEvent.change(input(), { target: { value: "12.ABC.345/01DE-35" } });
    await waitFor(() => expect(screen.getByTestId("card-number")).toBe(document.activeElement));
    expect(input().getAttribute("inputmode")).toBe("text");
  });
});

describe("when the letters leave the document again", () => {
  const NUMERIC = "11.222.333/0001-81";
  const ALPHANUMERIC = "12.ABC.345/01DE-35";

  it("goes back to numbers when letters mode was the field's own switch", () => {
    render(<Field />);
    fireEvent.change(input(), { target: { value: ALPHANUMERIC } });
    expect(input().getAttribute("inputmode")).toBe("text");
    fireEvent.change(input(), { target: { value: NUMERIC } });
    expect(input().getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByTestId("list-cpf-keyboard").textContent).toContain("Seu CNPJ tem letras? Usar teclado com letras");
  });

  it("keeps the letters the buyer chose with the link", () => {
    render(<Field />);
    fireEvent.click(screen.getByTestId("list-cpf-keyboard"));
    fireEvent.change(input(), { target: { value: NUMERIC } });
    expect(input().getAttribute("inputmode")).toBe("text");
  });

  it("keeps the letters the buyer chose with the link, even after an alphanumeric paste came and went", () => {
    render(<Field />);
    fireEvent.click(screen.getByTestId("list-cpf-keyboard"));
    fireEvent.change(input(), { target: { value: ALPHANUMERIC } });
    fireEvent.change(input(), { target: { value: NUMERIC } });
    expect(input().getAttribute("inputmode")).toBe("text");
  });

  it("re-enters a focused field on the way back, so the keypad is the number one again", async () => {
    recordInputModeAtFocus();
    render(<FocusedOnOpen taxId="" />);
    await waitFor(() => expect(input().getAttribute("data-focused-with")).toBe("numeric"));
    fireEvent.change(input(), { target: { value: ALPHANUMERIC } });
    await waitFor(() => expect(input().getAttribute("data-focused-with")).toBe("numeric text"));
    fireEvent.change(input(), { target: { value: NUMERIC } });
    await waitFor(() => expect(input().getAttribute("data-focused-with")).toBe("numeric text numeric"));
    await waitFor(() => expect(input()).toBe(document.activeElement));
  });

  it("leaves a focused field alone on a computer, where the keyboard has letters anyway", async () => {
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
    recordInputModeAtFocus();
    render(<FocusedOnOpen taxId="" />);
    await waitFor(() => expect(input().getAttribute("data-focused-with")).toBe("numeric"));
    fireEvent.change(input(), { target: { value: ALPHANUMERIC } });
    expect(input().getAttribute("inputmode")).toBe("numeric");
    expect(input().getAttribute("data-focused-with")).toBe("numeric");
  });
});
