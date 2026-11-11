/**
 * The question a held sheet asks is drawn ABOVE that sheet (FUT-4478).
 *
 * A `controlled` sheet (every `UsableModal` phone sheet) stays open when its
 * host refuses a close, and the host answers with an `AlertDialog` ("leave
 * without saving?"). The dialog opens at `zIndex.modal` (1300). A sheet raised
 * above that — by a host's stack (`BASE + depth * STEP`), or by a host theme
 * that lifts bottom drawers to `stackedOverlayZIndex` (1400) — then covered the
 * question: in the DOM, unseen and unclickable, so ✕ seemed to do nothing.
 * Before the sheet was held it slid away first and the question showed.
 *
 * jsdom does not hit-test, so these read the stacking order itself: the
 * computed z-index of the dialog's root against the sheet's drawer root, both
 * portalled to `body`, where the larger one paints on top.
 */
import { createTheme, ThemeProvider } from "@mui/material/styles/index.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider } from "../../../feedback/StackedModal";
import { UsableModal } from "../../../feedback/UsableModal";
import { Sheet } from "../../Sheet";
import { AlertDialog } from "../AlertDialog";

/** The level a host theme lifts a bottom drawer to: `zIndex.modal` plus the stack's headroom. */
const LIFTED = 1400;

/** `useMediaQuery(down('sm'))` asks a `max-width` query: true on a phone. */
function stubPhone(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query.includes("max-width"),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const zOf = (element: Element | null): number => Number(getComputedStyle(element as HTMLElement).zIndex);

const questionRoot = (): Element | null => screen.getByRole("alertdialog").closest(".MuiDialog-root");

function Question({ asking, onDone }: { asking: boolean; onDone: () => void }): ReactElement {
  return (
    <AlertDialog
      open={asking}
      title="Leave without saving?"
      confirmText="Keep editing"
      cancelText="Discard"
      onConfirm={onDone}
      onCancel={onDone}
      onClose={onDone}
      data-testid="leave"
    />
  );
}

/** A form on a raised sheet whose host refuses every close with a question. */
function GuardedSheet({ controlled, questionModal }: { controlled: boolean; questionModal?: number }): ReactElement {
  const [asking, setAsking] = useState(false);
  const question = <Question asking={asking} onDone={() => setAsking(false)} />;
  return (
    <>
      <Sheet
        open
        controlled={controlled}
        position="bottom"
        zIndex={LIFTED}
        dataTestId="s"
        onOpenChange={(next) => {
          if (!next) setAsking(true);
        }}
      >
        <p>form</p>
      </Sheet>
      {questionModal === undefined ? (
        question
      ) : (
        <ThemeProvider theme={createTheme({ zIndex: { modal: questionModal } })}>{question}</ThemeProvider>
      )}
    </>
  );
}

/** The same guard on a `UsableModal`'s phone sheet, opened over a host's stacked panel. */
function GuardedModalInStack(): ReactElement {
  const [asking, setAsking] = useState(false);
  return (
    <StackedModalProvider>
      <StackedModal open onClose={vi.fn()} navigationTitle="Board" backLabel="Back" dataTestId="host" />
      <UsableModal
        open
        onClose={() => setAsking(true)}
        title="Edit order"
        closeLabel="Close"
        backLabel="Back"
        dataTestId="um"
      >
        <p>form</p>
      </UsableModal>
      <Question asking={asking} onDone={() => setAsking(false)} />
    </StackedModalProvider>
  );
}

describe("a question asked over a held sheet", () => {
  it("stacks above a held sheet a host raised past zIndex.modal", async () => {
    render(<GuardedSheet controlled />);
    fireEvent.click(screen.getByTestId("s-click-catcher"));

    const sheet = screen.getByText("form").closest(".MuiDrawer-root");
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(zOf(sheet)).toBe(LIFTED);
    expect(zOf(questionRoot())).toBeGreaterThan(zOf(sheet));
  });

  it("stacks above a phone UsableModal held over a host's stacked panel", async () => {
    stubPhone();
    render(<GuardedModalInStack />);
    const sheet = (await screen.findByRole("dialog", { name: "Edit order" })).closest(".MuiDrawer-root");
    fireEvent.click(screen.getByTestId("um-click-catcher"));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    // The sheet still stands behind the question: the close only asked.
    expect(screen.getByText("form")).toBeVisible();
    expect(zOf(questionRoot())).toBeGreaterThan(zOf(sheet));
  });

  it("leaves a dialog at its own level when no held sheet is open", async () => {
    render(<GuardedSheet controlled={false} />);
    fireEvent.click(screen.getByTestId("s-click-catcher"));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    // An uncontrolled sheet has already gone; nothing is lifted.
    expect((questionRoot() as HTMLElement).style.zIndex).toBe("");
  });

  it("leaves a dialog its own level when its theme already puts it above the held sheet", async () => {
    render(<GuardedSheet controlled questionModal={LIFTED + 10} />);
    fireEvent.click(screen.getByTestId("s-click-catcher"));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect((questionRoot() as HTMLElement).style.zIndex).toBe("");
    expect(zOf(questionRoot())).toBe(LIFTED + 10);
  });
});
