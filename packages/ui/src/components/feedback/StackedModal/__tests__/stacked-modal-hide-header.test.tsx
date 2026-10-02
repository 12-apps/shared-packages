/**
 * `hideHeader`: a root panel whose content brings its own header draws no bar,
 * and is named by that header — but a stacked panel keeps its back arrow.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StackedModal, StackedModalProvider } from "../index";

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
});
