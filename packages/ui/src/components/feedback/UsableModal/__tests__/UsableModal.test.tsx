/**
 * UsableModal through the DOM: which surface each viewport gets, that only
 * that surface's module is ever loaded, and the footer and ways out of both.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ modal: 0, sheet: 0 }));

vi.mock("../UsableModal.modal", async (importOriginal) => {
  loaded.modal += 1;
  return importOriginal();
});
vi.mock("../UsableModal.sheet", async (importOriginal) => {
  loaded.sheet += 1;
  return importOriginal();
});

import { StackedModal, StackedModalProvider } from "../../StackedModal";
import { UsableModal } from "../UsableModal";
import type { UsableModalProps } from "../UsableModal.types";

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

function props(overrides: Partial<UsableModalProps> = {}): UsableModalProps {
  return {
    open: true,
    onClose: vi.fn(),
    title: "New order",
    closeLabel: "Close",
    backLabel: "Back",
    footer: <button type="button">Next</button>,
    dataTestId: "um",
    children: <p>Body</p>,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UsableModal — the surface follows the viewport", () => {
  it("draws a stacked modal on a computer, with the footer at its foot", async () => {
    stubViewport(false);
    render(<UsableModal {...props()} />);

    expect(await screen.findByTestId("um-title")).toHaveTextContent("New order");
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByTestId("um-footer")).toHaveTextContent("Next");
  });

  it("draws a bottom sheet on a phone, with the same title, body and footer", async () => {
    stubViewport(true);
    render(<UsableModal {...props()} />);

    expect(await screen.findByText("Body")).toBeInTheDocument();
    expect(screen.getByText("New order")).toBeInTheDocument();
    expect(screen.getByTestId("um-footer")).toHaveTextContent("Next");
    // The stacked modal's title bar is never drawn on a phone.
    await waitFor(() => expect(screen.queryByTestId("um-title")).toBeNull());
  });

  it("lets the host fix the surface whatever the viewport", async () => {
    stubViewport(false);
    render(<UsableModal {...props({ layout: "sheet" })} />);

    expect(await screen.findByText("Body")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("um-title")).toBeNull());
  });
});

describe("UsableModal — each surface is loaded on demand", () => {
  it("loads nothing while closed, and only the computer's surface once open", async () => {
    stubViewport(false);
    const before = { ...loaded };
    const view = render(<UsableModal {...props({ open: false })} />);
    expect(loaded).toEqual(before);

    view.rerender(<UsableModal {...props()} />);
    await screen.findByTestId("um-title");
    expect(loaded.modal).toBeGreaterThanOrEqual(1);
    expect(loaded.sheet).toBe(before.sheet);
  });
});

describe("UsableModal — the ways out", () => {
  it("closes from the stacked modal's ✕", async () => {
    stubViewport(false);
    const onClose = vi.fn();
    render(<UsableModal {...props({ onClose })} />);

    fireEvent.click(await screen.findByTestId("um-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the sheet's ✕", async () => {
    stubViewport(true);
    const onClose = vi.fn();
    render(<UsableModal {...props({ onClose })} />);

    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("joins a stack the host already keeps instead of starting its own", async () => {
    stubViewport(false);
    render(
      <StackedModalProvider>
        <StackedModal open onClose={vi.fn()} navigationTitle="Board" backLabel="Back" dataTestId="host" />
        <UsableModal {...props()} />
      </StackedModalProvider>,
    );

    // Pushed over the host's panel, so it offers the way back to it.
    expect(await screen.findByTestId("um-back-button")).toBeInTheDocument();
  });
});
