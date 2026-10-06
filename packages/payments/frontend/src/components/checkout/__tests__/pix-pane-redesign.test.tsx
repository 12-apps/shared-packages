// @vitest-environment jsdom
/**
 * The 2026-10-06 Pix redesign (FUT-3367, task FUT-3368): the pane a buyer pays
 * from, and the after-copy face that follows a copy.
 *
 * jsdom evaluates no `@container` query, so these tests see the NARROW layout
 * — which is the point of R14: the first paint, before any measurement, is
 * already the phone layout, with every panel mounted. The wide layout is CSS
 * over the same nodes, proven in a browser by the contract script.
 */
import { act, cleanup, fireEvent, render, screen } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useState, type JSX, type ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { PixView } from "../pix-view";
import { PixStageProvider } from "../pix-stage";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, OrderStatus } from "../types";
import type { Result } from "../../../result";

const NOW = new Date("2026-10-06T12:00:00.000Z").getTime();
const pix = PT_BR_CHECKOUT_SCREENS_COPY.pix;

function pixOrder(confirmation?: "MANUAL"): CheckoutOrder {
  return {
    orderId: "o-redesign",
    status: "AWAITING_PAYMENT",
    method: "PIX",
    totalCents: 4250,
    subtotalCents: 4250,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: "R$ 42,50",
    pix: {
      copyPaste: "00020126BR.GOV.BCB.PIX-redesign",
      expiresAt: new Date(NOW + 30 * 60_000).toISOString(),
      ...(confirmation ? { confirmation } : {}),
    },
  };
}

/** A server whose status answer the test sets (flakiness rule: state on one object). */
function server(): { client: CheckoutClient; fail: () => void } {
  const state: { answer: Result<OrderStatus> } = { answer: { ok: true, data: "AWAITING_PAYMENT" } };
  const client = { getStatus: async () => state.answer } as unknown as CheckoutClient;
  return {
    client,
    fail: () => {
      state.answer = { ok: false, error: "Sem conexão" } as unknown as Result<OrderStatus>;
    },
  };
}

/** The payment step's half, as a host: the flag in React state, and an optional way to the card. */
function StageHost({ preferCard, children }: { preferCard?: () => void; children: ReactNode }): JSX.Element {
  const [afterCopy, setAfterCopy] = useState(false);
  return <PixStageProvider stage={{ afterCopy, setAfterCopy, preferCard }}>{children}</PixStageProvider>;
}

function mount(order: CheckoutOrder, client: CheckoutClient, preferCard?: () => void): ReturnType<typeof render> {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <CheckoutClientProvider client={client}>
        <StageHost preferCard={preferCard}>{children}</StageHost>
      </CheckoutClientProvider>
    );
  }
  return render(<PixView order={order} onResolved={vi.fn()} />, { wrapper: Wrapper });
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the pane before a copy", () => {
  it("opens on the Copia e cola tab, with the QR mounted behind the other tab", async () => {
    mount(pixOrder(), server().client);
    await elapse(0);

    expect(screen.getByRole("tablist", { name: pix.tabsLabel })).toBeTruthy();
    expect(screen.getByRole("tab", { name: pix.copyPasteTab }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: pix.qrTab }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("pix-code").textContent).toBe("00020126BR.GOV.BCB.PIX-redesign");
    expect(screen.getByTestId("pix-copy").textContent).toContain(pix.copyAction);
    // R14: mounted, merely hidden — so `pix-qr` is always in the document.
    expect(screen.getByTestId("pix-qr")).toBeTruthy();
  });

  it("renders each kept test id exactly once (R16)", async () => {
    mount(pixOrder("MANUAL"), server().client);
    await elapse(0);

    for (const id of ["pix-view", "pix-qr", "pix-code", "pix-copy", "pix-expiry", "pix-awaiting"]) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
  });

  it("switches to the QR tab and back", async () => {
    mount(pixOrder(), server().client);
    await elapse(0);

    fireEvent.click(screen.getByRole("tab", { name: pix.qrTab }));
    expect(screen.getByRole("tab", { name: pix.qrTab }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(pix.qrTabCaption)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: pix.copyPasteTab }));
    expect(screen.getByRole("tab", { name: pix.copyPasteTab }).getAttribute("aria-selected")).toBe("true");
  });

  it("says the heading in the brand's case", async () => {
    mount(pixOrder(), server().client);
    await elapse(0);

    expect(screen.getByText("Pague com Pix")).toBeTruthy();
  });
});

describe("after a copy", () => {
  it("moves a manual Pix to the store's checklist", async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    mount(pixOrder("MANUAL"), server().client);
    await elapse(0);

    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);

    expect(writeText).toHaveBeenCalledWith("00020126BR.GOV.BCB.PIX-redesign");
    expect(screen.getByTestId("pix-after-copy")).toBeTruthy();
    expect(screen.getByTestId("pix-after-copy-title").textContent).toBe("Aguardando a loja");
    expect(screen.getByTestId("pix-after-copy-step-1").getAttribute("data-state")).toBe("done");
    expect(screen.getByTestId("pix-after-copy-step-2").getAttribute("data-state")).toBe("current");
    expect(screen.getByTestId("pix-after-copy-step-3").textContent).toMatch(/A loja confirma o pagamento — até \d{2}:\d{2}$/);
    expect(screen.getByTestId("pix-awaiting").textContent).toBe(pix.verifying);
    // The pane it replaced is gone.
    expect(screen.queryAllByTestId("pix-copy")).toHaveLength(0);
  });

  it("moves an automatic Pix to the bank's checklist (D3)", async () => {
    stubClipboard(vi.fn(async () => undefined));
    mount(pixOrder(), server().client);
    await elapse(0);

    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);

    expect(screen.getByTestId("pix-after-copy-title").textContent).toBe("Aguardando o pagamento");
    expect(screen.getByTestId("pix-after-copy-step-3").textContent).toContain("O banco confirma o pagamento automaticamente");
  });

  it("copies again, and says so for two seconds", async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    mount(pixOrder("MANUAL"), server().client);
    await elapse(0);
    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(3_000);

    fireEvent.click(screen.getByTestId("pix-copy-again"));
    await elapse(0);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("pix-copy-again").textContent).toContain(pix.copiedAction);

    await elapse(2_100);
    expect(screen.getByTestId("pix-copy-again").textContent).toContain(pix.copyAgainAction);
  });

  it("goes back to the pane on its QR tab from Ver QR code", async () => {
    stubClipboard(vi.fn(async () => undefined));
    mount(pixOrder("MANUAL"), server().client);
    await elapse(0);
    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);

    fireEvent.click(screen.getByTestId("pix-show-qr"));
    await elapse(0);

    expect(screen.queryAllByTestId("pix-after-copy")).toHaveLength(0);
    expect(screen.getByRole("tab", { name: pix.qrTab }).getAttribute("aria-selected")).toBe("true");
  });

  it("stays on the pane when the clipboard refuses the write (R13)", async () => {
    stubClipboard(vi.fn(async () => {
      throw new Error("denied");
    }));
    mount(pixOrder("MANUAL"), server().client);
    await elapse(0);

    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);

    expect(screen.queryAllByTestId("pix-after-copy")).toHaveLength(0);
    expect(screen.getByTestId("pix-code")).toBeTruthy();
  });

  it("stays on the pane when the browser has no clipboard at all (R13)", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    mount(pixOrder("MANUAL"), server().client);
    await elapse(0);

    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);

    expect(screen.queryAllByTestId("pix-after-copy")).toHaveLength(0);
  });

  it("offers the card only when the step has a way to it (R11)", async () => {
    stubClipboard(vi.fn(async () => undefined));
    const preferCard = vi.fn();
    mount(pixOrder("MANUAL"), server().client, preferCard);
    await elapse(0);
    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);

    fireEvent.click(screen.getByTestId("pix-prefer-card"));
    expect(preferCard).toHaveBeenCalledTimes(1);

    cleanup();
    mount(pixOrder("MANUAL"), server().client);
    await elapse(0);
    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);
    expect(screen.queryAllByTestId("pix-prefer-card")).toHaveLength(0);
  });

  it("puts the stalled-poll panel where the verifying line was (R12)", async () => {
    stubClipboard(vi.fn(async () => undefined));
    const status = server();
    mount(pixOrder("MANUAL"), status.client);
    await elapse(0);
    fireEvent.click(screen.getByTestId("pix-copy"));
    await elapse(0);

    status.fail();
    await elapse(60_000);

    expect(screen.getByTestId("pix-check-again")).toBeTruthy();
    expect(screen.queryAllByTestId("pix-awaiting")).toHaveLength(0);
  });
});
