/**
 * StackedModal's title is ONE heading, and the dialog is named by it.
 *
 * The bar used to be MUI's `DialogTitle` — an `h2` — with `navigationTitle`
 * inside it as a second `h2` of the same words. On screen the title printed
 * once; a screen reader heard it twice, as a heading inside a heading, and the
 * dialog's `aria-labelledby` pointed at the OUTER one, whose text also carried
 * the bar's buttons ("close", "Voltar") and header actions.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StackedModal, StackedModalProvider } from "../index";

const TITLE = "Concluídos do turno";

afterEach(cleanup);

describe("StackedModal's title", () => {
  it("is exactly one heading, and the dialog's accessible name", () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle={TITLE} modalId="one">
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(TITLE);
    expect(dialog).toHaveAccessibleName(TITLE);
  });

  it("keeps the header's actions and the ✕ out of the name", () => {
    render(
      <StackedModalProvider>
        <StackedModal
          backLabel="Voltar"
          open
          onClose={() => undefined}
          navigationTitle={TITLE}
          modalId="actions"
          actions={<button type="button">Salvar</button>}
        >
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName(TITLE);
    expect(screen.getByRole("button", { name: "close" })).toBeInTheDocument();
  });

  it("names the deeper panel by its own title when it shows a back button", () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle="Primeiro" modalId="first">
          <p>first</p>
        </StackedModal>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle={TITLE} modalId="second">
          <p>second</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    const second = screen.getByRole("button", { name: "Voltar" }).closest("[role='dialog']");
    expect(second).not.toBeNull();
    const dialog = second as HTMLElement;
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(dialog).toHaveAccessibleName(TITLE);
  });

  it("leaves an untitled panel's bar as it was", () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} modalId="untitled">
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    // Out of this fix's reach, and pinned so it does not move by accident: with
    // no title the bar is still MUI's `h2`, and still what the dialog points at.
    const dialog = screen.getByRole("dialog");
    const bar = within(dialog).getByRole("heading", { level: 2 });
    expect(bar).toHaveAttribute("id", "modal-title-untitled");
    expect(dialog).toHaveAttribute("aria-labelledby", "modal-title-untitled");
  });

  it("gives the title's id to one element only", () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle={TITLE} modalId="unique">
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(document.querySelectorAll("#modal-title-unique")).toHaveLength(1);
  });

  it("keeps a caller's own aria-labelledby", () => {
    render(
      <StackedModalProvider>
        <p id="own-label">Meu rótulo</p>
        <StackedModal
          backLabel="Voltar"
          open
          onClose={() => undefined}
          modalId="labelled"
          aria-labelledby="own-label"
        >
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Meu rótulo");
  });
});
