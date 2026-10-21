// @vitest-environment jsdom
/**
 * FUT-3711 — the list's CPF/wallet top and the computer's "Resumo do pedido"
 * body are chunks of their own, loaded through the host's `lazy` slot (its
 * stale-chunk-safe loader), so a checkout that never draws them never parses
 * them.
 *
 *  - Both parts are built through the host's loader, once per loader.
 *  - What the CPF holds is decided outside the deferred part: the pay button
 *    is held before the field is on screen.
 *  - The top and the rows land TOGETHER: no row is drawn and then pushed down.
 *    The top is started at list mount, so a later "Alterar" never suspends.
 *  - The column's frame and pay-button slot are drawn at once and never
 *    change element: the button keeps its node and its focus as the body lands.
 *  - A chunk that fails is caught per part — the rows, the frame and the pay
 *    button stay — and is tried once more, importing again.
 */
import { lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { PART_RETRY_MS } from "../list/lazy-body";
import type { CheckoutLazy } from "../ui";
import { SAVED_VISA, installGoogle, onPageStore, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

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

/** {@link gatedLoader}, keeping each part it is asked to build. */
function watchedGatedLoader(): { loader: CheckoutLazy; asked: unknown[]; open: () => void } {
  const asked: unknown[] = [];
  const { loader: gated, open } = gatedLoader();
  const loader: CheckoutLazy = (load) => {
    asked.push(load);
    return gated(load);
  };
  return { loader, asked, open };
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

/** A loader whose first `failures` imports reject — a chunk gone after a deploy. */
function failingLoader(failures: number): { loader: CheckoutLazy; attempts: () => number } {
  const tries = { count: 0 };
  const loader: CheckoutLazy = (load) =>
    lazy(async () => {
      tries.count += 1;
      if (tries.count <= failures) throw new Error("chunk gone");
      return load();
    });
  return { loader, attempts: () => tries.count };
}

/** A loader whose first import rejects and whose retry waits until `open()`. */
function failThenGatedLoader(): { loader: CheckoutLazy; attempts: () => number; open: () => void } {
  const tries = { count: 0 };
  const latch: { open: () => void } = { open: () => undefined };
  const gate = new Promise<void>((resolve) => {
    latch.open = resolve;
  });
  const loader: CheckoutLazy = (load) =>
    lazy(async () => {
      tries.count += 1;
      if (tries.count === 1) throw new Error("chunk gone");
      await gate;
      return load();
    });
  return { loader, attempts: () => tries.count, open: () => latch.open() };
}

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

/** A store asking no CPF, so neither part has anything to draw on a phone. */
const noCpfStore = () => onPageStore({ customerSchema: [] });

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  uninstallWallets();
  vi.restoreAllMocks();
  cleanup();
});

/** Google Pay installed, its `isReadyToPay` answering only once `ready()` is called. */
function installGoogleLate(): { ready: () => void } {
  installGoogle();
  const latch: { open: () => void } = { open: () => undefined };
  const gate = new Promise<void>((resolve) => {
    latch.open = resolve;
  });
  const api = (window as unknown as { google: { payments: { api: { PaymentsClient: new () => { isReadyToPay: () => Promise<{ result: boolean }> } } } } }).google.payments.api;
  const Ready = api.PaymentsClient;
  api.PaymentsClient = class extends Ready {
    isReadyToPay = async () => {
      await gate;
      return { result: true };
    };
  };
  return { ready: () => latch.open() };
}

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

  it("builds the summary column's body through it on a computer", async () => {
    frameWidth(1280);
    const { loader, asked } = watchedLoader();
    renderList({ config: noCpfStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: false, components: { lazy: loader } });
    const column = await screen.findByTestId("list-summary-column");
    await within(column).findByTestId("list-summary-body");
    expect(within(column).getByTestId("list-pay")).toBeTruthy();
    expect(asked).toHaveLength(1);
  });

  it("is not asked for either part where neither can be drawn: a phone, no CPF asked or on file, no wallet", async () => {
    const { loader, asked } = watchedLoader();
    renderList({ config: noCpfStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: false, components: { lazy: loader } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(payButton().disabled).toBe(false));
    expect(asked).toHaveLength(0);
  });
});

describe("while the top's chunk loads", () => {
  it("draws neither the top nor the rows — they land together — and the CPF already holds the button", async () => {
    const { loader, open } = gatedLoader();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: false, components: { lazy: loader } });
    await screen.findByTestId("list-top-loading");
    await waitFor(() => expect(screen.getByTestId("list-blocked-reason").textContent).toBe("Digite seu CPF para pagar pelo app."));
    expect(payButton().disabled).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD")).toBeNull());
    await act(async () => open());
    const field = (await screen.findByTestId("list-buyer-taxId")) as HTMLInputElement;
    expect(screen.getByTestId("list-option-CARD")).toBeTruthy();
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "529.982.247-25" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("starts the top at list mount, so 'Alterar' opens the CPF without hiding the rows", async () => {
    const { loader, open } = gatedLoader();
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste" }, components: { lazy: loader } });
    // No top to draw yet (a CPF on file), so the rows are there — and the top's chunk is already asked for.
    const pix = await screen.findByTestId("list-option-PIX");
    await act(async () => open());
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    fireEvent.click(await screen.findByTestId("list-payer-change"));
    expect(await screen.findByTestId("list-buyer-taxId")).toBeTruthy();
    expect(screen.getByTestId("list-option-PIX")).toBe(pix);
    expect(pix.style.display).not.toBe("none");
  });
});

describe("a top that first appears once the rows are drawn (FUT-3711 review round 2)", () => {
  it("never hides the rows: a declared wallet turning ready suspends the top on its own", async () => {
    const { loader, asked, open } = watchedGatedLoader();
    const google = installGoogleLate();
    renderList({ config: walletStore(["GOOGLE_PAY"], { customerSchema: [] }), client: stubClient(), taxIdOnFile: false, list: { totalCents: 2700 }, components: { lazy: loader } });
    // No CPF, none on file, the wallet not ready yet: the rows are drawn — and the declared wallet already started the top.
    const row = await screen.findByTestId("list-option-CARD");
    expect(asked).toHaveLength(1);
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    await act(async () => google.ready());
    // The wallet is ready: the top mounts, suspended on its own, and the rows stay drawn.
    await screen.findByTestId("list-top-loading");
    expect(screen.getByTestId("list-option-CARD")).toBe(row);
    expect(row.closest('[style*="display: none"]')).toBeNull();
    expect(screen.getByTestId("list-option-PIX-radio")).toHaveProperty("checked", true);
    await act(async () => open());
    expect(await screen.findByTestId("list-wallets")).toBeTruthy();
    expect(screen.getByTestId("list-option-CARD")).toBe(row);
  });
});

describe("while the summary column's body loads (a computer)", () => {
  it("draws the frame and the pay button at once, and the button keeps its node and focus as the body lands", async () => {
    frameWidth(1280);
    const { loader, open } = gatedLoader();
    renderList({ config: noCpfStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: false, components: { lazy: loader } });
    const column = await screen.findByTestId("list-summary-column");
    expect(within(column).getByTestId("list-summary-loading")).toBeTruthy();
    const pay = (await within(column).findByTestId("list-pay")) as HTMLButtonElement;
    await waitFor(() => expect(pay.disabled).toBe(false));
    // The buyer on "Pagar" — the focus the body's landing must not take away.
    // Called through the prototype: the flakiness rule's fixer loops on a bare `.focus()` in an act().
    await act(async () => HTMLElement.prototype.focus.call(pay));
    await waitFor(() => expect(document.activeElement).toBe(pay));
    expect(screen.getAllByTestId("list-pay")).toHaveLength(1);
    await act(async () => open());
    await within(column).findByTestId("list-summary-body");
    expect(within(column).getByTestId("list-pay")).toBe(pay);
    await waitFor(() => expect(document.activeElement).toBe(pay));
    expect(screen.getAllByTestId("list-summary-action")).toHaveLength(1);
  });
});

describe("a part whose chunk fails to load", () => {
  it("leaves the column's frame and a working pay button, then imports the body again", async () => {
    frameWidth(1280);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loader, attempts } = failingLoader(1);
    renderList({ config: noCpfStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: false, components: { lazy: loader } });
    const column = await screen.findByTestId("list-summary-column");
    await waitFor(() => expect(attempts()).toBe(1));
    await waitFor(() => expect((within(column).getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("payment-list")).toBeTruthy();
    await within(column).findByTestId("list-summary-body", {}, { timeout: PART_RETRY_MS * 5 });
    expect(attempts()).toBe(2);
  });

  it("keeps the rows and the CPF's hold without the top, then imports the top again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loader, attempts } = failingLoader(1);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: false, components: { lazy: loader } });
    // The preload and the top share one build: one failed import fails both.
    await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(screen.getByTestId("list-blocked-reason").textContent).toBe("Digite seu CPF para pagar pelo app."));
    expect(payButton().disabled).toBe(true);
    expect(await screen.findByTestId("list-buyer-taxId", {}, { timeout: PART_RETRY_MS * 5 })).toBeTruthy();
    expect(attempts()).toBe(2);
  });
  it("keeps the rows drawn while the failed top imports again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loader, attempts, open } = failThenGatedLoader();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: false, components: { lazy: loader } });
    const row = await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(attempts()).toBe(2), { timeout: PART_RETRY_MS * 5 });
    // The retry is in flight: the rows the failure left on screen stay drawn.
    expect(screen.getByTestId("list-option-CARD")).toBe(row);
    expect(row.closest('[style*="display: none"]')).toBeNull();
    expect(payButton().disabled).toBe(true);
    await act(async () => open());
    expect(await screen.findByTestId("list-buyer-taxId")).toBeTruthy();
    expect(screen.getByTestId("list-option-CARD")).toBe(row);
  });
});
