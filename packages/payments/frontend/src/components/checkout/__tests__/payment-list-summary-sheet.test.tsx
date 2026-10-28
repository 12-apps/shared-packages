// @vitest-environment jsdom
/**
 * FUT-589 — "Resumo do pedido" on a phone, as a sheet the bar's line opens.
 *
 * A computer lists the order in the column beside the payment; a phone drew no
 * lines at all. The owner chose the bar's line as the way in (option B):
 *
 *  - on a phone the line carries "Ver resumo", and the whole line is one button;
 *  - it opens a sheet above the bar with the column's own body — the lines, the
 *    host's money rows, "Total" — and the focus lands on its heading;
 *  - Escape, the ✕, the scrim and the line close it, and the focus goes back
 *    to the line;
 *  - the host's money rows know they are in the sheet (`useInSummarySheet`), so
 *    a control among them can stay out of it;
 *  - a card or wallet charge that starts closes it, and the line comes back
 *    when the charge is cancelled; the payer line's "Alterar" closes it too;
 *  - it stays anchored on the bar's top while the bar changes height, and its
 *    content takes the bar line's own column;
 *  - the Pix screen, the hand-off, a host's own column and a layout with
 *    nothing to list draw the plain line;
 *  - a computer keeps its column and draws no "Ver resumo".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { JSX } from "react";

import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { useInSummarySheet } from "../list/summary-sheet";

import { SAVED_VISA, handOffStore, installGoogle, listFlow, onPageStore, orderFor, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

const LINES = [
  { key: "marmita", quantity: 1, name: "Marmita de Frango Grelhado", totalLabel: "R$ 26,90" },
  { key: "suco", quantity: 1, name: "Suco Natural 500ml", totalLabel: "R$ 10,90" },
];

/** The host's money rows, with a control that must stay on the page and out of the sheet. */
function MoneyRows(): JSX.Element {
  const inSheet = useInSummarySheet();
  return (
    <div data-testid="host-money-rows">
      <span>Cupom Paladira</span>
      <span>-R$ 3,78</span>
      {inSheet ? null : <input type="checkbox" aria-label="Usar meu saldo" />}
    </div>
  );
}

const SUMMARY = "2 itens · Taxa de entrega R$ 6,00";

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

function renderPhone(): void {
  renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, discountLines: <MoneyRows />, cartTotal: "R$ 40,02", list: { summary: SUMMARY } });
}

/** The sheet, once its body has landed. */
async function openSheet(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId("list-summary-toggle"));
  const sheet = await screen.findByTestId("list-summary-sheet");
  await within(sheet).findByTestId("list-summary-body");
  return sheet;
}

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  uninstallWallets();
  cleanup();
});

/** An inner control that handles Escape itself, as a menu or a field's own clear would. */
function handlesEscape(element: HTMLElement): void {
  element.addEventListener("keydown", (event) => event.preventDefault());
}

/** Put the focus on `target`, as a Tab would. Called through the prototype, as payment-list-lazy does. */
async function focusOn(target: HTMLElement): Promise<void> {
  await act(async () => HTMLElement.prototype.focus.call(target));
  await waitFor(() => expect(document.activeElement).toBe(target));
}

const toggleButton = (): HTMLButtonElement => screen.getByTestId("list-summary-toggle") as HTMLButtonElement;

/** The sheet is gone and the line is back to closed. */
async function sheetGone(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
  expect(toggleButton().getAttribute("aria-expanded")).toBe("false");
}

/** Every element measures as `rect`, the bar's line as `line` when given. */
function measure(rect: { width: number; top: number }, line?: { left: number; width: number; top: number }): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = line && this.getAttribute("data-testid") === "list-summary-toggle" ? line : { left: 0, ...rect };
    return { ...box, height: 40, right: box.left + box.width, bottom: box.top + 40, x: box.left, y: box.top, toJSON: () => ({}) } as DOMRect;
  });
}

/** A ResizeObserver that records what it watches and is fired by hand. */
function stubResizeObserver() {
  const observers: { callback: () => void; targets: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
  class StubObserver {
    entry: (typeof observers)[number];
    constructor(callback: () => void) {
      this.entry = { callback, targets: [], disconnect: vi.fn() };
      observers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.push(target);
    }
    unobserve() {}
    disconnect() {
      this.entry.disconnect();
    }
  }
  vi.stubGlobal("ResizeObserver", StubObserver);
  return { watching: (element: Element) => observers.filter((observer) => observer.targets.includes(element)) };
}

describe("a phone", () => {
  beforeEach(() => frameWidth(390));

  it("puts 'Ver resumo' on the bar's line, closed", async () => {
    renderPhone();
    const toggle = await screen.findByTestId("list-summary-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.textContent).toBe(`${SUMMARY}Ver resumo`);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-summary-column")).toBeNull());
  });

  it("opens the column's body above the bar: the lines, the money rows, Total", async () => {
    renderPhone();
    const sheet = await openSheet();
    expect(within(sheet).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1× Marmita de Frango GrelhadoR$ 26,90", "1× Suco Natural 500mlR$ 10,90"]);
    expect(within(sheet).getByTestId("list-summary-money").textContent).toBe("Cupom Paladira-R$ 3,78");
    expect(within(sheet).getByTestId("pay-bar-total").textContent).toBe("R$ 40,02");
    expect(screen.getByTestId("list-summary-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("list-summary-sheet").getAttribute("aria-modal")).toBe("false");
    const heading = document.getElementById(screen.getByTestId("list-summary-sheet").getAttribute("aria-labelledby") ?? "");
    expect(heading?.textContent).toBe("Resumo do pedido");
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("tells the host's money rows they are in the sheet, so their control stays out of it", async () => {
    renderPhone();
    const sheet = await openSheet();
    expect(within(sheet).getByTestId("host-money-rows")).toBeTruthy();
    await waitFor(() => expect(within(sheet).queryByRole("checkbox", { name: "Usar meu saldo" })).toBeNull());
  });

  it("closes on Escape and gives the focus back to the line", async () => {
    renderPhone();
    await openSheet();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("list-summary-toggle")));
  });

  it("closes on the ✕, on the scrim and on the line itself, and gives the focus back to the line each time", async () => {
    renderPhone();
    const closers = [
      () => screen.getByRole("button", { name: "Fechar o resumo" }),
      () => screen.getByTestId("list-summary-scrim"),
      () => toggleButton(),
    ];
    for (const closer of closers) {
      await openSheet();
      fireEvent.click(closer());
      await sheetGone();
      await waitFor(() => expect(document.activeElement).toBe(toggleButton()));
    }
  });

  it("names its ✕ 'Fechar o resumo' and hides the scrim from assistive tech", async () => {
    renderPhone();
    const sheet = await openSheet();
    expect(within(sheet).getByRole("button", { name: "Fechar o resumo" })).toBeTruthy();
    expect(screen.getByTestId("list-summary-scrim").getAttribute("aria-hidden")).toBe("true");
  });

  it("stays open on an Escape an inner control already handled", async () => {
    renderPhone();
    const sheet = await openSheet();
    handlesEscape(sheet);
    fireEvent.keyDown(within(sheet).getByRole("button", { name: "Fechar o resumo" }), { key: "Escape" });
    expect(screen.getByTestId("list-summary-sheet")).toBeTruthy();
  });

  it("closes when the payer line's 'Alterar' opens the CPF at the top, with the focus in the CPF", async () => {
    renderPhone();
    fireEvent.click(await screen.findByTestId("list-option-PIX-radio"));
    await openSheet();
    fireEvent.click(screen.getByTestId("list-payer-change"));
    const field = await screen.findByTestId("list-buyer-taxId");
    await sheetGone();
    await waitFor(() => expect(document.activeElement).toBe(field));
    // Only a charge disables the line: it opens the sheet again.
    expect(toggleButton().disabled).toBe(false);
    fireEvent.click(toggleButton());
    await screen.findByTestId("list-summary-sheet");
  });

  it("closes when the card's charge starts, and stays closed while it runs", async () => {
    renderPhone();
    fireEvent.click(await screen.findByTestId("list-option-CARD-radio"));
    await openSheet();
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-charge-bar");
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    expect(toggleButton().disabled).toBe(true);
  });

  it("puts the focus on the bar when a charge closes the sheet with the focus inside it", async () => {
    renderPhone();
    fireEvent.click(await screen.findByTestId("list-option-CARD-radio"));
    const sheet = await openSheet();
    await focusOn(within(sheet).getByRole("button", { name: "Fechar o resumo" }));
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-charge-bar");
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("list-charge-cancel")));
  });

  it("enables the line again after a cancelled charge, the sheet still closed", async () => {
    renderPhone();
    fireEvent.click(await screen.findByTestId("list-option-CARD-radio"));
    await openSheet();
    fireEvent.click(screen.getByTestId("list-pay"));
    fireEvent.click(await screen.findByTestId("list-charge-cancel"));
    await waitFor(() => expect(toggleButton().disabled).toBe(false));
    await sheetGone();
  });

  it("closes when a wallet's charge starts, and holds the line while it runs", async () => {
    installGoogle(() => new Promise(() => undefined));
    renderList({ config: walletStore(), client: stubClient(), lines: LINES, discountLines: <MoneyRows />, list: { summary: SUMMARY, totalCents: 2700 } });
    const native = await screen.findByTestId("google-pay-native");
    await waitFor(() => expect(native.getAttribute("aria-disabled")).toBeNull());
    const sheet = await openSheet();
    await focusOn(within(sheet).getByRole("button", { name: "Fechar o resumo" }));
    fireEvent.click(screen.getByTestId("google-pay-native"));
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    expect(toggleButton().disabled).toBe(true);
    // The focus was in the sheet: it lands in the bar, not on <body>.
    await waitFor(() => expect(screen.getByTestId("list-pay-bar").contains(document.activeElement)).toBe(true));
  });

  it("is gone with the list face: the Pix screen draws the plain line", async () => {
    renderPhone();
    fireEvent.click(await screen.findByTestId("list-option-PIX-radio"));
    await openSheet();
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-pix");
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-summary-toggle")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Ver resumo")).toBeNull());
    expect(screen.getByTestId("list-bar-summary").textContent).toBe(SUMMARY);
  });

  it("is gone with the list face: the hand-off draws the plain line", async () => {
    const createOrder = vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({
      ok: true,
      data: orderFor(input.method, { hostedCheckoutUrl: "https://pay.example/checkout/1" }),
    }));
    renderList({ config: handOffStore(), client: stubClient([]), createOrder, buyer: { name: "Ana", phone: "11987654321" }, lines: LINES, list: { summary: SUMMARY } });
    fireEvent.click(await screen.findByTestId("list-option-HAND_OFF-radio"));
    await openSheet();
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-waiting");
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Ver resumo")).toBeNull());
    expect(screen.getByTestId("list-bar-summary").textContent).toBe(SUMMARY);
  });

  it("draws the plain line when there is nothing to list", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { summary: SUMMARY } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-summary-toggle")).toBeNull());
    expect(screen.getByTestId("list-bar-summary").textContent).toBe(SUMMARY);
  });

  it("forgets an open sheet when the lines empty out, and does not reopen when they return", async () => {
    const host = { config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, cartTotal: "R$ 40,02", list: { summary: SUMMARY } };
    const view = renderList(host);
    await openSheet();
    view.rerender(listFlow({ ...host, lines: [] }));
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-summary-toggle")).toBeNull());
    view.rerender(listFlow(host));
    await screen.findByTestId("list-summary-toggle");
    await sheetGone();
  });

  it("draws no toggle when the host lays out its own column (summaryTarget)", async () => {
    const aside = document.createElement("aside");
    document.body.appendChild(aside);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { summaryTarget: aside, summary: SUMMARY } });
    await within(aside).findByTestId("list-summary-column");
    await waitFor(() => expect(screen.queryByTestId("list-summary-toggle")).toBeNull());
    expect(within(aside).getByTestId("list-bar-summary").textContent).toBe(SUMMARY);
    aside.remove();
  });
});

describe("a phone, measured", () => {
  it("stays on the bar's top when the bar changes height, and stops watching it on close", async () => {
    // A 768px-tall screen: the sheet's bottom is the screen's height less the line's top, plus the 8px gap.
    vi.stubGlobal("innerHeight", 768);
    const resize = stubResizeObserver();
    measure({ width: 390, top: 0 }, { left: 0, width: 390, top: 600 });
    renderPhone();
    const sheet = await openSheet();
    expect(getComputedStyle(sheet).bottom).toBe("176px");
    const bar = toggleButton().parentElement as HTMLElement;
    const [observer] = resize.watching(bar);
    expect(observer).toBeTruthy();
    // The payer line or a reason grows the bar: its line moves up.
    measure({ width: 390, top: 0 }, { left: 0, width: 390, top: 520 });
    act(() => observer?.callback());
    await waitFor(() => expect(getComputedStyle(screen.getByTestId("list-summary-sheet")).bottom).toBe("256px"));
    fireEvent.keyDown(document, { key: "Escape" });
    await sheetGone();
    expect(observer?.disconnect).toHaveBeenCalled();
  });

  it("lines its content up with the bar's line: its left and its width", async () => {
    measure({ width: 600, top: 0 }, { left: 44, width: 512, top: 600 });
    renderPhone();
    const sheet = await openSheet();
    const content = sheet.firstElementChild as HTMLElement;
    expect(getComputedStyle(content).marginLeft).toBe("44px");
    expect(getComputedStyle(content).width).toBe("512px");
  });
});

describe("a computer", () => {
  beforeEach(() => frameWidth(1280));

  it("keeps its column and draws no 'Ver resumo'", async () => {
    renderPhone();
    await screen.findByTestId("list-summary-column");
    await waitFor(() => expect(screen.queryByTestId("list-summary-toggle")).toBeNull());
    expect(screen.getByTestId("list-bar-summary").textContent).toBe(SUMMARY);
  });
});
