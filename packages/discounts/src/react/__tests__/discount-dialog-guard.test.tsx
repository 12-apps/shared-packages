// @vitest-environment jsdom
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext, useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider } from "@12-apps/ui/feedback/StackedModal";

import { DirtyReportContext, DiscountDialog } from "../discount-dialog";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";

/**
 * Leaving with changes (FUT-4478, Story "Chrome"): the dialog's ONE `onClose`
 * — the ✕, the veil, Esc, the sheet's back — asks "Sair sem salvar?" while the
 * form says it is dirty, closes at once while it is clean, and a discard closes
 * silently. A stand-in form reports dirty through the same context the real
 * one does.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const { chrome } = copy.steps;
const SURFACE_LOADED = { timeout: 10_000 };

function DirtyForm(): JSX.Element {
  const report = useContext(DirtyReportContext);
  return (
    <>
      <button type="button" data-testid="make-dirty" onClick={() => report?.(true)}>
        change
      </button>
      <button type="button" data-testid="make-clean" onClick={() => report?.(false)}>
        undo
      </button>
    </>
  );
}

function Harness({ onClosed }: { onClosed: () => void }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <DiscountDialog
      open={open}
      onClose={() => {
        onClosed();
        setOpen(false);
      }}
      title="Editar desconto"
      copy={copy}
    >
      <DirtyForm />
    </DiscountDialog>
  );
}

async function opened(onClosed = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
  render(<Harness onClosed={onClosed} />);
  await screen.findByTestId("make-dirty", undefined, SURFACE_LOADED);
  return onClosed;
}

/** `useMediaQuery(down('sm'))` asks a `max-width` query: true on a phone. */
function stubViewport(phone: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: phone && query.includes("max-width"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/** The dialog stacked over a host's panel, so it offers the way back to it. */
function Stacked({ onClosed }: { onClosed: () => void }): JSX.Element {
  return (
    <StackedModalProvider>
      <StackedModal open onClose={() => {}} navigationTitle="Descontos" backLabel="Voltar" dataTestId="host" />
      <Harness onClosed={onClosed} />
    </StackedModalProvider>
  );
}

/** Dirty, the way out asked: the question shows and the form stays. */
async function asksAndStays(closed: ReturnType<typeof vi.fn>): Promise<void> {
  expect(await screen.findByText(chrome.leaveTitle)).toBeTruthy();
  expect(closed).not.toHaveBeenCalled();
  expect(screen.getByTestId("make-dirty")).toBeTruthy();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the leave guard", () => {
  it("G1: clean, the ✕ closes at once with no question", async () => {
    const closed = await opened();
    fireEvent.click(screen.getByRole("button", { name: copy.form.dialog.close }));
    expect(closed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(chrome.leaveTitle)).toBeNull());
  });

  it("G2: dirty, the ✕ asks and keeps the form; Continuar editando stays", async () => {
    const closed = await opened();
    fireEvent.click(screen.getByTestId("make-dirty"));
    fireEvent.click(screen.getAllByRole("button", { name: copy.form.dialog.close })[0]!);
    expect(await screen.findByText(chrome.leaveTitle)).toBeTruthy();
    expect(screen.getByText(chrome.leaveBody)).toBeTruthy();
    expect(closed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: chrome.leaveStay }));
    await waitFor(() => expect(screen.queryByText(chrome.leaveTitle)).toBeNull());
    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByTestId("make-dirty")).toBeTruthy();
  });

  it("G3: dirty, Esc asks too, and Descartar e sair closes silently", async () => {
    const closed = await opened();
    fireEvent.click(screen.getByTestId("make-dirty"));
    fireEvent.keyDown(screen.getByTestId("make-dirty"), { key: "Escape" });
    expect(await screen.findByText(chrome.leaveTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: chrome.leaveDiscard }));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("G4: a form changed and changed back closes at once again", async () => {
    const closed = await opened();
    fireEvent.click(screen.getByTestId("make-dirty"));
    fireEvent.click(screen.getByTestId("make-clean"));
    fireEvent.keyDown(screen.getByTestId("make-clean"), { key: "Escape" });
    expect(closed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(chrome.leaveTitle)).toBeNull());
  });
});

describe("every way out asks while dirty", () => {
  it("G5a: the phone sheet's veil asks, and the sheet stays", async () => {
    stubViewport(true);
    const closed = await opened();
    fireEvent.click(screen.getByTestId("make-dirty"));
    fireEvent.click(screen.getByTestId("discount-dialog-click-catcher"));
    await asksAndStays(closed);
  });

  it("G5b: the computer's backdrop asks, and the dialog stays", async () => {
    stubViewport(false);
    const closed = await opened();
    fireEvent.click(screen.getByTestId("make-dirty"));
    const veils = document.querySelectorAll<HTMLElement>(".MuiBackdrop-root");
    expect(veils.length).toBeGreaterThan(0);
    fireEvent.click(veils[veils.length - 1]!);
    await asksAndStays(closed);
  });

  it("G6: the back arrow over a stacked panel asks, and the dialog stays", async () => {
    stubViewport(false);
    const closed = vi.fn();
    render(<Stacked onClosed={closed} />);
    await screen.findByTestId("make-dirty", undefined, SURFACE_LOADED);
    fireEvent.click(screen.getByTestId("make-dirty"));
    fireEvent.click(await screen.findByTestId("discount-dialog-back-button"));
    await asksAndStays(closed);
    fireEvent.click(screen.getByRole("button", { name: chrome.leaveDiscard }));
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
