// @vitest-environment jsdom
/**
 * FUT-3811 — "Nome impresso no cartão" arrives filled with the account
 * holder's name on the one list.
 *
 *  - The new card opens with the name the buyer arrived with, trimmed and
 *    never re-cased; with no name it opens empty, as before.
 *  - A name a provider would refuse as a card holder's is not offered.
 *  - What the buyer types — or clears — is theirs: the pre-fill is never
 *    applied again over it.
 *  - A buyer with no CPF on file still gets the name.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { holderPrefill } from "../list/use-list-state";
import { onPageStore, renderList, stubClient } from "./list-harness";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
});

const radio = (testId: string): Promise<HTMLElement> => screen.findByTestId(`${testId}-radio`);
const holder = (): HTMLInputElement => screen.getByTestId("card-holder") as HTMLInputElement;

/** Choose the card row and wait for its fields. */
async function openCard(): Promise<HTMLInputElement> {
  fireEvent.click(await radio("list-option-CARD"));
  await waitFor(() => expect(screen.getByTestId("card-holder")).toBeTruthy());
  return holder();
}

describe("the card holder's name on the list (FUT-3811)", () => {
  it("arrives filled with the account holder's name", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), buyer: { name: "Ana Teste", taxId: "52998224725" } });
    expect((await openCard()).value).toBe("Ana Teste");
  });

  it("arrives empty when the account has no name", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), buyer: { taxId: "52998224725" } });
    expect((await openCard()).value).toBe("");
  });

  it("is given to a buyer with no CPF on file too", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, buyer: { name: "Bruno Lima" } });
    expect((await openCard()).value).toBe("Bruno Lima");
  });

  it("never overwrites what the buyer typed, coming back to the card", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), buyer: { name: "Ana Teste", taxId: "52998224725" } });
    fireEvent.change(await openCard(), { target: { value: "ANA M TESTE" } });
    fireEvent.click(await radio("list-option-PIX"));
    expect((await openCard()).value).toBe("ANA M TESTE");
  });

  it("is not applied again once the buyer cleared it", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), buyer: { name: "Ana Teste", taxId: "52998224725" } });
    fireEvent.change(await openCard(), { target: { value: "" } });
    fireEvent.click(await radio("list-option-PIX"));
    expect((await openCard()).value).toBe("");
  });
});

describe("holderPrefill", () => {
  it("is the stored name, trimmed, in its own case", () => {
    expect(holderPrefill("  Ana Teste ")).toBe("Ana Teste");
    expect(holderPrefill("joão d'ávila-souza")).toBe("joão d'ávila-souza");
  });

  it("is empty with no name, or one too short to be a holder's", () => {
    expect(holderPrefill(undefined)).toBe("");
    expect(holderPrefill("   ")).toBe("");
    expect(holderPrefill("A")).toBe("");
  });

  it("is empty for a name past the holder length a provider takes", () => {
    expect(holderPrefill("Maria Aparecida dos Santos Oliveira")).toBe("");
    expect(holderPrefill("Maria Aparecida dos Santos Oli")).toBe("Maria Aparecida dos Santos Oli");
  });

  it("is empty for a name carrying characters no card prints", () => {
    expect(holderPrefill("Ana 2º Teste")).toBe("");
    expect(holderPrefill("ana@exemplo.com")).toBe("");
  });
});
