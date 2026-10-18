// @vitest-environment jsdom
/**
 * FUT-3711 — the list re-lays itself out without remounting. A host crossing
 * its two-column threshold (`paymentList.summaryTarget` given, then left out —
 * an iPad rotated between 1366 and 1024) and the flow's own frame crossing
 * `WIDE_CHECKOUT_MIN` both move the "Resumo do pedido" column and the pay
 * button; neither may cost the buyer the card they were typing or the row
 * they chose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { WIDE_CHECKOUT_MIN } from "../payment-step-layout";
import { listFlow, onPageStore, renderList, stubClient } from "./list-harness";

const input = (testId: string): HTMLInputElement => screen.getByTestId(testId) as HTMLInputElement;

/** The flow's frame measures `width` now. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

/** A ResizeObserver the suite can fire, standing in for the browser's. */
function installResizeObserver(): { resize: () => void } {
  const observers = new Set<() => void>();
  class StubResizeObserver {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
    }
    observe(): void {
      observers.add(this.callback);
    }
    unobserve(): void {}
    disconnect(): void {
      observers.delete(this.callback);
    }
  }
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  return { resize: () => observers.forEach((fire) => fire()) };
}

/** Choose "Cartão de crédito" and type a card, as far as the fields go. */
async function typeACard(): Promise<void> {
  fireEvent.click(await screen.findByTestId("list-option-CARD-radio"));
  fireEvent.change(await screen.findByTestId("card-number"), { target: { value: "4111 1111 1111 1111" } });
  fireEvent.change(input("card-holder"), { target: { value: "ANA TESTE" } });
}

function expectTheCardKept(): void {
  expect(input("card-number").value).toBe("4111 1111 1111 1111");
  expect(input("card-holder").value).toBe("ANA TESTE");
  expect(input("list-option-CARD-radio").checked).toBe(true);
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe("the host's two columns coming and going (summaryTarget)", () => {
  it("keeps the typed card and the chosen row from undefined → element → undefined", async () => {
    frameWidth(WIDE_CHECKOUT_MIN - 1);
    const aside = document.createElement("aside");
    document.body.appendChild(aside);
    const host = { config: onPageStore(), client: stubClient() };
    const { rerender } = renderList(host);
    await typeACard();
    const typedInto = input("card-number");

    rerender(listFlow({ ...host, list: { summaryTarget: aside } }));
    await within(aside).findByTestId("list-pay");
    expectTheCardKept();
    expect(input("card-number")).toBe(typedInto);

    rerender(listFlow({ ...host, list: {} }));
    await waitFor(() => expect(within(aside).queryByTestId("list-pay")).toBeNull());
    expect(screen.getByTestId("list-pay-bar")).toBeTruthy();
    expectTheCardKept();
    expect(input("card-number")).toBe(typedInto);
    aside.remove();
  });
});

describe("the flow's own frame crossing WIDE_CHECKOUT_MIN", () => {
  it("keeps the typed card and the chosen row from a phone to a computer and back", async () => {
    const { resize } = installResizeObserver();
    frameWidth(WIDE_CHECKOUT_MIN - 1);
    renderList({ config: onPageStore(), client: stubClient() });
    await typeACard();
    const typedInto = input("card-number");

    frameWidth(1280);
    act(() => resize());
    await screen.findByTestId("list-columns");
    expectTheCardKept();
    expect(input("card-number")).toBe(typedInto);

    frameWidth(WIDE_CHECKOUT_MIN - 1);
    act(() => resize());
    await waitFor(() => expect(screen.queryByTestId("list-columns")).toBeNull());
    expectTheCardKept();
    expect(input("card-number")).toBe(typedInto);
  });
});
