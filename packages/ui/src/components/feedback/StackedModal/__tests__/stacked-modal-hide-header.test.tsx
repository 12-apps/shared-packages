/**
 * `hideHeader`: a root panel whose content brings its own header draws no bar,
 * and is named by that header — but a stacked panel keeps its back arrow.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { createTheme } from "@mui/material/styles";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider } from "../index";
import { dialogRootStyles } from "../StackedModal.styles";

afterEach(cleanup);

describe("StackedModal hideHeader", () => {
  it("draws no bar, and the dialog takes the name its content header gives it", () => {
    render(
      <StackedModalProvider>
        <StackedModal
          backLabel="Voltar"
          open
          onClose={() => undefined}
          hideHeader
          aria-labelledby="own-title"
          modalId="root"
          dataTestId="panel"
        >
          <h2 id="own-title">Açaí na tigela</h2>
        </StackedModal>
      </StackedModalProvider>,
    );
    const dialog = screen.getByRole("dialog");
    // An untitled bar is itself an `h2` (see the heading suite): with no bar,
    // the content's own title is the dialog's only heading.
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Açaí na tigela");
    expect(dialog).toHaveAccessibleName("Açaí na tigela");
  });

  it("keeps the bar on a stacked panel, whose back arrow is the only way out", () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} modalId="first">
          <p>first</p>
        </StackedModal>
        <StackedModal
          backLabel="Voltar"
          open
          onClose={() => undefined}
          hideHeader
          modalId="second"
          dataTestId="second"
        >
          <p>second</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(screen.getByTestId("second-header")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
  });

  it("leaves the bar alone when it is not asked", () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle="Título" modalId="plain" dataTestId="plain">
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(screen.getByTestId("plain-header")).toBeInTheDocument();
  });

  it("keeps the root bar-less once a child opens over it", () => {
    const tree = (child: boolean) => (
      <StackedModalProvider>
        <StackedModal
          backLabel="Voltar"
          open
          onClose={() => undefined}
          hideHeader
          aria-labelledby="root-title"
          modalId="root"
          dataTestId="root"
        >
          <h2 id="root-title">Açaí na tigela</h2>
        </StackedModal>
        {child && (
          <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle="Novo adicional" modalId="child" dataTestId="child">
            <p>child</p>
          </StackedModal>
        )}
      </StackedModalProvider>
    );
    const view = render(tree(false));
    view.rerender(tree(true));
    // The child carries the back arrow; the receding root still draws no bar,
    // though the stack is now two deep.
    expect(screen.getByTestId("child-header")).toBeInTheDocument();
    // (The receding root is aria-hidden behind the child, hence `hidden`.)
    expect(within(screen.getByTestId("root")).getAllByRole("heading", { hidden: true })).toHaveLength(1);
  });

  it("warns when nothing names the dialog", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} hideHeader modalId="unnamed">
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("aria-labelledby"));
    warn.mockRestore();
  });
});

describe("StackedModal's backdrop style", () => {
  it("reaches the dialog's own backdrop only, not a sheet's inside the panel", () => {
    const rules = dialogRootStyles(createTheme(), { modalRole: "primary" } as Parameters<typeof dialogRootStyles>[1]);
    expect(Object.keys(rules)).toContain("& > .MuiBackdrop-root");
    expect(Object.keys(rules)).not.toContain("& .MuiBackdrop-root");
  });
});
