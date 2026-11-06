// @vitest-environment jsdom
/**
 * FUT-4416 — the host's nudges and notes in the bar and in "Resumo do pedido"
 * (C21, C23, E29/E30's info box, L24).
 *
 * A nudge is the host's sentence and a link: the link either chooses one of
 * the store's ONLINE rows ("Pagar com Pix") or runs the host's own act ("Não
 * usar crédito"). A door option is never chosen for the buyer by a tap here,
 * and the type has no way to ask for one. A note ("info") is a neutral box
 * with no link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutListNudge } from "../list/types";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;

const TO_PIX: CheckoutListNudge = { id: "to-pix", text: "No Pix fica", amountLabel: "R$ 126,75", action: { label: "Pagar com Pix", choose: { method: "PIX" } } };

function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("a nudge that chooses a row (C21)", () => {
  it("is drawn in the bar with its amount and link, and the link chooses the row — then it is gone", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { nudges: [TO_PIX] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    const nudge = screen.getByTestId("list-nudge-to-pix");
    expect(nudge.textContent).toBe("No Pix fica R$ 126,75Pagar com Pix");
    expect(within(screen.getByTestId("list-pay-bar")).getByTestId("list-nudge-to-pix")).toBe(nudge);
    fireEvent.click(within(nudge).getByTestId("list-nudge-to-pix-action"));
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("list-nudge-to-pix")).toBeNull());
  });

  it("is not drawn for a row the store does not offer, while the host's other nudges are", async () => {
    const other: CheckoutListNudge = { id: "other", text: "Outro aviso", action: { label: "Fazer", onPress: vi.fn() } };
    renderList({ config: onPageStore({ methods: ["CARD"] }), client: stubClient([SAVED_VISA]), list: { nudges: [TO_PIX, other] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("list-nudge-to-pix")).toBeNull());
    expect(screen.getByTestId("list-nudge-other")).toBeTruthy();
  });

  it("steps aside while the card's 5-second bar counts", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { nudges: [TO_PIX] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    expect(screen.getByTestId("list-nudge-to-pix")).toBeTruthy();
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-charge-bar");
    await waitFor(() => expect(screen.queryByTestId("list-nudge-to-pix")).toBeNull());
  });
});

describe("a nudge's choice is the buyer's own (review round 1)", () => {
  it("takes the buyer to the CPF at the top, as a tap on the row does", async () => {
    const nativeScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, list: { lastMethod: "CARD", nudges: [TO_PIX] } });
    await screen.findByTestId("list-cpf");
    fireEvent.click(await screen.findByTestId("list-nudge-to-pix-action"));
    const field = screen.getByTestId("list-buyer-taxId");
    const input = field.tagName === "INPUT" ? field : field.querySelector("input");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(radio("list-option-PIX").checked).toBe(true);
    Element.prototype.scrollIntoView = nativeScroll;
  });

  it("wraps its link under the sentence on a narrow row rather than squeezing it (U1, U6)", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { nudges: [TO_PIX] } });
    const strip = await screen.findByTestId("list-nudge-to-pix");
    expect(getComputedStyle(strip).flexWrap).toBe("wrap");
    const link = screen.getByTestId("list-nudge-to-pix-action").closest("[data-nudge-link]") as HTMLElement;
    expect(getComputedStyle(link).marginLeft).toBe("auto");
  });
});

describe("a nudge that runs the host's act (C23)", () => {
  it("calls the host's press, and leaves the choice alone", async () => {
    const onPress = vi.fn();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { nudges: [{ id: "drop-credit", text: "Sem o crédito, no Pix fica", amountLabel: "R$ 126,75", action: { label: "Não usar crédito", onPress } }] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(screen.getByTestId("list-nudge-drop-credit-action"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(radio("list-option-CARD").checked).toBe(true);
  });
});

describe("a note (E29, E30)", () => {
  it("is a neutral box with no link, after the nudges", async () => {
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      list: { nudges: [{ id: "door-info", tone: "info", text: "Na porta, outra forma muda o valor." }, TO_PIX] },
    });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    const note = screen.getByTestId("list-nudge-door-info");
    expect(note.getAttribute("role")).toBe("note");
    expect(note.getAttribute("data-tone")).toBe("info");
    await waitFor(() => expect(within(note).queryByRole("button")).toBeNull());
    const nudge = screen.getByTestId("list-nudge-to-pix");
    expect(nudge.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("in the computer's column (E31, L24)", () => {
  it("sits after Total and before the button", async () => {
    frameWidth(1280);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: [{ key: "a", quantity: 1, name: "A", totalLabel: "R$ 27,00" }], list: { nudges: [TO_PIX] } });
    const column = await screen.findByTestId("list-summary-column");
    const total = await within(column).findByTestId("payment-step-total");
    const nudge = await within(column).findByTestId("list-nudge-to-pix");
    const button = within(column).getByTestId("list-pay");
    expect(total.compareDocumentPosition(nudge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nudge.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
