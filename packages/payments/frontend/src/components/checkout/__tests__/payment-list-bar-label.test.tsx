// @vitest-environment jsdom
/**
 * FUT-3692 (Future Pay UI reviews of the mercado and the mesa) — the bar's label.
 *
 *  - U4: with nothing chosen the button reads "Escolha como pagar" and the
 *    helper under it said "Escolha como pagar." — the same words twice. A held
 *    reason that is the button's own label is announced, not drawn again; one
 *    that says something else is still drawn.
 *  - U1: at 320px the label wrapped onto two lines. It never wraps (it is cut
 *    with an ellipsis, its full text in the title) and carries no letter-spacing
 *    of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";

import { repeatsLabel } from "../list/list-bar";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const helper = (): string | null => screen.queryByTestId("list-blocked-reason")?.textContent ?? null;

/** The label's own span: the first child of the button's row. */
function labelOf(button: HTMLElement): HTMLElement {
  const label = button.querySelector<HTMLElement>("span[title]");
  if (!label) throw new Error("the button has no label span");
  return label;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("a reason that repeats the button's label", () => {
  it("is recognised through case and closing punctuation, and only then", () => {
    expect(repeatsLabel("Escolha como pagar.", "Escolha como pagar")).toBe(true);
    expect(repeatsLabel("  escolha como pagar ", "Escolha como pagar")).toBe(true);
    expect(repeatsLabel("Escolha o cartão.", "Escolha como pagar")).toBe(false);
    expect(repeatsLabel(null, "Escolha como pagar")).toBe(false);
    expect(repeatsLabel("Escolha como pagar.", undefined)).toBe(false);
  });

  it("is said once with nothing chosen: on the button, and to a screen reader", async () => {
    renderList({ config: onPageStore(), client: stubClient([]) });
    await screen.findByTestId("payment-list");

    expect(payButton().disabled).toBe(true);
    expect(payButton().textContent).toBe("Escolha como pagarR$ 27,00");
    expect(helper()).toBeNull();
    expect(screen.getByTestId("list-bar-live").textContent).toBe("Escolha como pagar.");
  });

  it("is still drawn when it says something the button does not", async () => {
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      list: { hold: { action: "Escolha o horário", reason: "Escolha o horário no passo 2." } },
    });
    await waitFor(() => expect(payButton().textContent).toBe("Escolha o horárioR$ 27,00"));

    expect(helper()).toBe("Escolha o horário no passo 2.");
  });

  it("is dropped for a host hold whose reason is its action", async () => {
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      list: { hold: { action: "Confirme o endereço", reason: "Confirme o endereço." } },
    });
    await waitFor(() => expect(payButton().textContent).toBe("Confirme o endereçoR$ 27,00"));

    expect(helper()).toBeNull();
    expect(screen.getByTestId("list-bar-live").textContent).toBe("Confirme o endereço.");
  });
});

describe("the button's label", () => {
  it("never wraps, is cut with an ellipsis, and is plain: no letter-spacing", async () => {
    renderList({ config: onPageStore(), client: stubClient([]) });
    await screen.findByTestId("payment-list");

    const words = labelOf(payButton());
    const style = getComputedStyle(words);
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.overflow).toBe("hidden");
    expect(style.textOverflow).toBe("ellipsis");
    // A plain label, as the prototype draws it: no tracking on top of the button's.
    expect(style.letterSpacing).toBe("normal");
    // Cut, not lost: the full words stay on the element and in the accessible name.
    expect(words.getAttribute("title")).toBe("Escolha como pagar");
    expect(payButton().textContent).toContain("Escolha como pagar");
  });
});
