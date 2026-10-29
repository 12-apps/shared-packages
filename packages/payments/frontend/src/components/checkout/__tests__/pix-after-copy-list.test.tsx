// @vitest-environment jsdom
/**
 * FUT-1181 + FUT-592 — the list's Pix after the copy, as the owner settled it
 * on 2026-10-28 (option A of the prototype, ADR 0129 kept): "Copiar de novo"
 * is the bar's button, OUTLINED, and the card keeps one outlined secondary —
 * "Mostrar QR code (para outro aparelho)" — and the one link, "Prefere pagar
 * com cartão?". Nothing on the face is drawn solid: the next step is in the
 * bank app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import { onPageStore, renderList, stubClient } from "./list-harness";

const words = PT_BR_PAYMENT_LIST_COPY.pixFace;

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

async function copied(methods: ("PIX" | "CARD")[] = ["PIX", "CARD"]) {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  renderList({ config: onPageStore({ methods }), client: stubClient([]) });
  await screen.findByTestId("payment-list");
  fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
  fireEvent.click(screen.getByTestId("list-pay"));
  await screen.findByTestId("list-pix");
  fireEvent.click(screen.getByTestId("list-pay"));
  await screen.findByTestId("pix-after-copy");
  return { writeText };
}

describe("the list's Pix after the copy", () => {
  it("puts 'Copiar de novo' in the bar, outlined, and copies again from there", async () => {
    const { writeText } = await copied();
    const bar = screen.getByTestId("list-pay-bar");
    const again = within(bar).getByTestId("pix-copy-again");
    expect(again.className).toContain("MuiButton-outlined");
    await waitFor(() => expect(again.textContent).toBe("Copiar de novo"), { timeout: 3000 });
    fireEvent.click(again);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(within(bar).getByTestId("pix-copy-again").textContent).toBe("Copiado!");
  });

  it("keeps the QR as an outlined button on the card, never a second copy", async () => {
    await copied();
    const face = screen.getByTestId("pix-after-copy");
    expect(within(face).queryAllByTestId("pix-copy-again")).toHaveLength(0);
    const qr = within(face).getByTestId("pix-show-qr");
    expect(qr.textContent).toBe(words.showQr);
    expect(qr.className).toContain("MuiButton-outlined");
  });

  it("draws nothing solid on the face or in its bar (ADR 0129)", async () => {
    await copied();
    const pane = screen.getByTestId("list-pix");
    expect(pane.querySelectorAll(".MuiButton-contained")).toHaveLength(0);
    expect(screen.getByTestId("list-pay-bar").querySelectorAll(".MuiButton-contained")).toHaveLength(0);
  });

  it("keeps 'Prefere pagar com cartão?' as the one link while the card is offered", async () => {
    await copied(["PIX", "CARD"]);
    const face = screen.getByTestId("pix-after-copy");
    const links = Array.from(face.querySelectorAll(".MuiButton-text"));
    expect(links.map((link) => link.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("cartão")]));
    expect(links.every((link) => (link.textContent ?? "").includes("cartão"))).toBe(true);
  });

  it("goes back to the code with the QR open, whose link then hides it", async () => {
    await copied();
    fireEvent.click(screen.getByTestId("pix-show-qr"));
    await screen.findByTestId("list-pix-code");
    expect(getComputedStyle(screen.getByTestId("list-pix-qr")).display).toBe("flex");
    expect(screen.getByTestId("list-pix-toggle-qr").textContent).toBe(words.hideQr);
    expect(screen.getByTestId("list-pay").textContent).toBe("Copiar código Pix");
  });

  it("draws the computer's QR beside the steps, for the list's own width query", async () => {
    await copied();
    const beside = screen.getByTestId("pix-after-copy-qr");
    expect(beside.querySelector("[role=img] svg")).not.toBeNull();
    expect(screen.getByTestId("pix-after-copy-step-2")).toBeTruthy();
  });
});
