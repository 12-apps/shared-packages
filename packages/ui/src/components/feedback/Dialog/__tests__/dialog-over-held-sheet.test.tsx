/**
 * A plain Dialog is drawn ABOVE a held sheet (FUT-4748).
 *
 * A host opens a plain `Dialog` (a change dialog, a reason picker) from a form
 * on a held phone sheet. The dialog opens at `zIndex.modal` (1300), the drawer
 * variant at `zIndex.drawer` (1200); a sheet raised past that covered it, in
 * the DOM but unseen and untappable. jsdom does not hit-test, so these read the
 * stacking order: the computed z-index of each root, both portalled to `body`.
 */
import { createTheme, ThemeProvider } from "@mui/material/styles/index.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Sheet } from "../../../data-display/Sheet";
import { Dialog } from "../Dialog";

const LIFTED = 1400;

afterEach(cleanup);

const zOf = (element: Element | null): number => Number(getComputedStyle(element as HTMLElement).zIndex);
const dialogRoot = (): HTMLElement => screen.getByText("body").closest(".MuiDialog-root, .MuiDrawer-root") as HTMLElement;

function Over({
  controlled,
  variant,
  style,
}: {
  controlled: boolean;
  variant?: "drawer";
  style?: React.CSSProperties;
}): ReactElement {
  // The host opens the dialog FROM the sheet's form, so the sheet is on screen first.
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setDialogOpen(true)}>
        open
      </button>
      <Sheet open controlled={controlled} position="bottom" zIndex={LIFTED} dataTestId="s" onOpenChange={() => undefined}>
        <p>form</p>
      </Sheet>
      <Dialog open={dialogOpen} variant={variant} title="Change" style={style}>
        <p>body</p>
      </Dialog>
    </>
  );
}

describe("a plain Dialog opened over a held sheet", () => {
  it("stacks above a held sheet raised past zIndex.modal", () => {
    render(<Over controlled />);
    fireEvent.click(screen.getByText("open"));
    const sheet = screen.getByText("form").closest(".MuiDrawer-root");
    expect(zOf(sheet)).toBe(LIFTED);
    expect(zOf(dialogRoot())).toBeGreaterThan(zOf(sheet));
  });

  it("lifts the drawer variant too, which opens below the modal level", () => {
    render(<Over controlled variant="drawer" />);
    fireEvent.click(screen.getByText("open"));
    const sheet = screen.getByText("form").closest(".MuiDrawer-root");
    expect(zOf(dialogRoot())).toBeGreaterThan(zOf(sheet));
  });

  it("leaves the dialog at its own level when no held sheet is open", () => {
    render(<Over controlled={false} />);
    fireEvent.click(screen.getByText("open"));
    expect(dialogRoot().style.zIndex).toBe("");
  });

  it("leaves the dialog its own level when its theme already puts it above the sheet", () => {
    render(
      <ThemeProvider theme={createTheme({ zIndex: { modal: LIFTED + 10 } })}>
        <Over controlled />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText("open"));
    expect(dialogRoot().style.zIndex).toBe("");
    expect(zOf(dialogRoot())).toBe(LIFTED + 10);
  });

  it("keeps a caller's own style when nothing needs lifting", () => {
    render(<Over controlled={false} style={{ opacity: 0.9 }} />);
    fireEvent.click(screen.getByText("open"));
    expect(dialogRoot().style.opacity).toBe("0.9");
    expect(dialogRoot().style.zIndex).toBe("");
  });
});
