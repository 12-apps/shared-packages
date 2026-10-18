// @vitest-environment jsdom
/**
 * FUT-3711 — the list's CPF/wallet top and the computer's "Resumo do pedido"
 * column are chunks of their own, loaded through the host's `lazy` slot (its
 * stale-chunk-safe loader), so a checkout that never draws them never parses
 * them.
 *
 *  - Both parts are built through the host's loader, once per loader.
 *  - What the CPF holds is decided outside the deferred part: the pay button
 *    is held before the field is on screen.
 *  - While the column's chunk loads, the pay button is already where the
 *    column will be — never missing, never a bar at the bottom.
 */
import { lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutLazy } from "../ui";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;

/** A loader that holds every deferred part until `open()`. */
function gatedLoader(): { loader: CheckoutLazy; open: () => void } {
  const latch: { open: () => void } = { open: () => undefined };
  const gate = new Promise<void>((resolve) => {
    latch.open = resolve;
  });
  const loader: CheckoutLazy = (load) => lazy(() => gate.then(load));
  return { loader, open: () => latch.open() };
}

/** React's own `lazy`, keeping each part it is asked to build. */
function watchedLoader(): { loader: CheckoutLazy; asked: unknown[] } {
  const asked: unknown[] = [];
  const loader: CheckoutLazy = (load) => {
    asked.push(load);
    return lazy(load);
  };
  return { loader, asked };
}

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("the host's loader (the `lazy` slot)", () => {
  it("builds the CPF/wallet top through it, once, however often the list renders", async () => {
    const { loader, asked } = watchedLoader();
    renderList({ config: onPageStore(), client: stubClient(), taxIdOnFile: false, components: { lazy: loader } });
    const field = await screen.findByTestId("list-buyer-taxId");
    expect(within(screen.getByTestId("list-top")).getByTestId("list-cpf")).toBeTruthy();
    fireEvent.change(field, { target: { value: "529" } });
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    await waitFor(() => expect(screen.getByTestId("list-option-PIX-radio")).toHaveProperty("checked", true));
    expect(asked).toHaveLength(1);
  });

  it("builds the summary column through it on a computer", async () => {
    frameWidth(1280);
    const { loader, asked } = watchedLoader();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), components: { lazy: loader } });
    const column = await screen.findByTestId("list-summary-column");
    expect(within(column).getByTestId("list-pay")).toBeTruthy();
    expect(asked).toHaveLength(1);
  });

  it("is not asked for either part where neither is drawn: a phone, a CPF on file, no wallet", async () => {
    const { loader, asked } = watchedLoader();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), components: { lazy: loader } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(payButton().disabled).toBe(false));
    expect(asked).toHaveLength(0);
  });
});

describe("while the CPF's chunk loads", () => {
  it("holds the pay button for the CPF before the field is on screen, and the field arrives empty", async () => {
    const { loader, open } = gatedLoader();
    renderList({ config: onPageStore(), client: stubClient(), taxIdOnFile: false, components: { lazy: loader } });
    await screen.findByTestId("payment-list");
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    await waitFor(() => expect(screen.getByTestId("list-blocked-reason").textContent).toBe("Digite seu CPF para pagar pelo app."));
    expect(payButton().disabled).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("list-cpf")).toBeNull());
    await act(async () => open());
    const field = (await screen.findByTestId("list-buyer-taxId")) as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "529.982.247-25" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });
});

describe("while the summary column's chunk loads (a computer)", () => {
  it("keeps the pay button reachable where the column goes, then hands it to the column", async () => {
    frameWidth(1280);
    const { loader, open } = gatedLoader();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), components: { lazy: loader } });
    await screen.findByTestId("payment-list");
    const waiting = await screen.findByTestId("list-summary-action");
    expect(waiting.getAttribute("data-loading")).toBe("true");
    await waitFor(() => expect((within(waiting).getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(screen.queryByTestId("list-summary-column")).toBeNull());
    expect(screen.getAllByTestId("list-pay")).toHaveLength(1);
    await act(async () => open());
    const column = await screen.findByTestId("list-summary-column");
    await waitFor(() => expect(within(column).getByTestId("list-pay")).toBeTruthy());
    expect(screen.getAllByTestId("list-pay")).toHaveLength(1);
    expect(screen.getAllByTestId("list-summary-action")).toHaveLength(1);
  });
});
