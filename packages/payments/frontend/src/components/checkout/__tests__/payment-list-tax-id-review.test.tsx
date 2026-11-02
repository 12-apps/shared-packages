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
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { taxIdInput } from "../../../card";
import { CpfTop } from "../list/cpf-top";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import type { BuyerInfo, CheckoutCustomerField } from "../types";

import { cleanup, fireEvent, render, screen } from "./test-utils";

afterEach(cleanup);

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
  it.each([
    ["CPF 529.982.247-25", "529.982.247-25", "52998224725"],
    ["CNPJ: 11.222.333/0001-81", "11.222.333/0001-81", "11222333000181"],
    ["cnpj:12.abc.345/01de-35", "12.ABC.345/01DE-35", "12ABC34501DE35"],
    ["12.ABC.345/01DE-35", "12.ABC.345/01DE-35", "12ABC34501DE35"],
  ])("%j keeps the document, not the label", (pasted, shown, kept) => {
    const buyers: BuyerInfo[] = [];
    render(<Field kept={buyers} />);
    fireEvent.change(input(), { target: { value: pasted } });
    expect(input().value).toBe(shown);
    expect(buyers.at(-1)?.taxId).toBe(kept);
  });

  it("drops a label only when something separates it, so a CNPJ beginning with CPF keeps its letters", () => {
    expect(taxIdInput("CPF 529.982.247-25")).toBe("52998224725");
    expect(taxIdInput("  cpf :  529.982.247-25")).toBe("52998224725");
    expect(taxIdInput("CPF12ABC34501")).toBe("CPF12ABC34501");
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
