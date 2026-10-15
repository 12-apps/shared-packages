// @vitest-environment jsdom
/**
 * FUT-3591/3592, UI review round 1 — the look rules that are facts of the DOM
 * rather than of a picture (the pictures are the visual gate's):
 *
 *  - a chosen row with nothing to open draws no box under it;
 *  - the button's amount never breaks; an action with no amount is centred;
 *  - a locked list is inert, not dimmed;
 *  - the 5-second bar's sentence is white, whatever the theme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const raising = () => vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("a chosen row", () => {
  it("opens no empty box when it has nothing to ask (Pix, CPF on file)", async () => {
    renderList({ config: onPageStore(), client: stubClient() });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    await waitFor(() => {
      expect(radio("list-option-PIX").checked).toBe(true);
      expect(screen.queryByTestId("list-option-PIX-content")).toBeNull();
    });
    fireEvent.click(radio("list-option-CARD"));
    await waitFor(() => expect(screen.getByTestId("list-option-CARD-content")).toBeTruthy());
  });
});

describe("the bar's button", () => {
  it("keeps the amount on one line, beside a label that may wrap", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    const amount = within(payButton()).getByText("R$ 27,00");
    expect(getComputedStyle(amount).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(amount.parentElement as HTMLElement).justifyContent).toBe("space-between");
  });

  it("centres an action that names no amount", async () => {
    renderList({ config: onPageStore(), client: stubClient(), createOrder: raising() });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(payButton());
    const label = await within(await screen.findByTestId("list-pix")).findByText("Copiar código Pix", { selector: "[data-testid=list-pay] span span" });
    expect(getComputedStyle(label.parentElement as HTMLElement).justifyContent).toBe("center");
  });
});

describe("a locked list", () => {
  it("is inert at full strength — no dimming", async () => {
    const door: CheckoutDoorOption = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: vi.fn(), pending: true };
    renderList({ config: onPageStore(), client: stubClient(), list: { door: [door] } });
    const list = await screen.findByTestId("payment-list");
    expect(list.hasAttribute("inert")).toBe(true);
    expect(getComputedStyle(list).opacity).not.toBe("0.6");
  });
});

describe("the 5-second bar", () => {
  it("writes its sentence in white", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(payButton());
    const bar = await screen.findByTestId("list-charge-bar");
    const sentence = bar.querySelector("span") as HTMLElement;
    expect(getComputedStyle(sentence).color).toBe("rgb(255, 255, 255)");
  });
});
