// @vitest-environment jsdom
/**
 * FUT-3849 — nothing to tap before the saved cards answer.
 *
 * The list drew its rows at once and read the buyer's saved cards after it
 * mounted. When they landed, the card row preselected itself and opened its
 * chips, moving every row below it — a tap on Dinheiro in that moment was
 * lost and the saved card stayed chosen (the storefront's entrega journey,
 * flaky on the daily suite). So the rows wait for the answer, and the first
 * list drawn already holds the choice it keeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;

function door(): CheckoutDoorOption {
  return { id: "cash", label: "Dinheiro", hint: "Diga se precisa de troco", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
}

/** A client whose saved cards answer only when the test says so. */
function heldCards(): { client: ReturnType<typeof stubClient>; answer: () => Promise<void> } {
  const client = stubClient([SAVED_VISA]);
  const held: { resolve?: (cards: (typeof SAVED_VISA)[]) => void } = {};
  const pending = new Promise<(typeof SAVED_VISA)[]>((resolve) => {
    held.resolve = resolve;
  });
  client.listInstruments.mockImplementation(async () => pending);
  return {
    client,
    answer: async () => {
      await act(async () => {
        held.resolve?.([SAVED_VISA]);
        await pending;
      });
    },
  };
}

describe("the payment list waits for the saved cards (FUT-3849)", () => {
  it("offers no row to tap while the saved cards are still on their way", async () => {
    const { client } = heldCards();
    renderList({ config: onPageStore(), client, list: { door: [door()] } });
    await waitFor(() => expect(screen.getByTestId("payment-list-loading").getAttribute("aria-busy")).toBe("true"));
    await waitFor(() => expect(screen.queryByTestId("payment-list")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-door-cash-radio")).toBeNull());
  });

  it("draws the list with the saved card already chosen", async () => {
    const { client, answer } = heldCards();
    renderList({ config: onPageStore(), client, list: { door: [door()] } });
    await screen.findByTestId("payment-list-loading");
    await answer();
    await screen.findByTestId("payment-list");
    // Synchronously after the list appears: no render in between draws it with nothing chosen.
    expect(radio("list-option-CARD").checked).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("payment-list-loading")).toBeNull());
  });

  it("keeps Dinheiro once the buyer taps it", async () => {
    const { client, answer } = heldCards();
    renderList({ config: onPageStore(), client, list: { door: [door()] } });
    await answer();
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(radio("list-door-cash").checked).toBe(true));
    expect(radio("list-option-CARD").checked).toBe(false);
  });

  it("draws the list for a buyer whose saved cards cannot be read", async () => {
    const client = stubClient();
    client.listInstruments.mockImplementation(async () => {
      throw new Error("offline");
    });
    renderList({ config: onPageStore(), client, list: { door: [door()] } });
    await screen.findByTestId("payment-list");
    expect(radio("list-door-cash")).toBeTruthy();
  });
});
