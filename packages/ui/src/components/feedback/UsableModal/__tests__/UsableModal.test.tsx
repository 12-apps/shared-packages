/**
 * UsableModal through the DOM: which surface each viewport gets, how it shares
 * a host's stack, and the footer and ways out of both. That only the drawn
 * surface's module loads is `UsableModal.lazy.test.tsx`, in a registry of its own.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider } from "../../StackedModal";
import { MODAL_STACK_BASE_Z_INDEX } from "../../../../tokens/layers";
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
  it("draws a stacked modal on a computer: a named dialog with the footer at its foot", async () => {
    stubViewport(false);
    render(<UsableModal {...props()} />);

    expect(await screen.findByTestId("um-title")).toHaveTextContent("New order");
    expect(screen.getByRole("dialog", { name: "New order" })).toBeInTheDocument();
    expect(screen.getByTestId("um-footer")).toHaveTextContent("Next");
  });

  it("draws a bottom sheet on a phone: a named dialog with the same title, body and footer", async () => {
    stubViewport(true);
    render(<UsableModal {...props()} />);

    expect(await screen.findByRole("dialog", { name: "New order" })).toHaveTextContent("Body");
    expect(screen.getByTestId("um-footer")).toHaveTextContent("Next");
    // The stacked modal's title bar is never drawn on a phone.
    await waitFor(() => expect(screen.queryByTestId("um-title")).toBeNull());
  });

  it("lets the host fix the surface whatever the viewport", async () => {
    stubViewport(false);
    render(<UsableModal {...props({ layout: "sheet" })} />);

    expect(await screen.findByRole("dialog", { name: "New order" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("um-title")).toBeNull());
  });

  it("keeps the surface it opened with when the viewport crosses `sm` while open", async () => {
    stubViewport(false);
    const view = render(<UsableModal {...props()} />);
    expect(await screen.findByTestId("um-title")).toBeInTheDocument();

    stubViewport(true);
    view.rerender(<UsableModal {...props({ children: <p>Still here</p> })} />);

    expect(await screen.findByText("Still here")).toBeInTheDocument();
    expect(screen.getByTestId("um-title")).toBeInTheDocument();
  });

  it("draws no footer bar for a footer of null, on either surface", async () => {
    stubViewport(false);
    const view = render(<UsableModal {...props({ footer: null })} />);
    expect(await screen.findByTestId("um-title")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("um-footer")).toBeNull());
    view.unmount();

    stubViewport(true);
    render(<UsableModal {...props({ footer: null })} />);
    expect(await screen.findByRole("dialog", { name: "New order" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("um-footer")).toBeNull());
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
});

describe("UsableModal — a host's stack", () => {
  function Host({ open, onHostClose }: { open: boolean; onHostClose: () => void }): React.JSX.Element {
    return (
      <StackedModalProvider>
        <StackedModal open onClose={onHostClose} navigationTitle="Board" backLabel="Back" dataTestId="host" />
        <UsableModal {...props({ open })} />
      </StackedModalProvider>
    );
  }

  it("joins a stack the host already keeps, offering the way back to it", async () => {
    stubViewport(false);
    render(<Host open onHostClose={vi.fn()} />);

    expect(await screen.findByTestId("um-back-button")).toBeInTheDocument();
  });

  it("hands the host's panel back once closed: its Esc works again", async () => {
    stubViewport(false);
    const onHostClose = vi.fn();
    const view = render(<Host open onHostClose={onHostClose} />);
    await screen.findByTestId("um-back-button");

    view.rerender(<Host open={false} onHostClose={onHostClose} />);
    // The host panel is primary again after the slide-out, so Esc reaches it.
    await waitFor(
      () => {
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onHostClose).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
  });

  it("opens the phone's sheet above the host's panels, never under them", async () => {
    stubViewport(true);
    render(<Host open onHostClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: "New order" });
    const drawer = dialog.closest(".MuiDrawer-root") as HTMLElement;
    expect(Number(getComputedStyle(drawer).zIndex)).toBeGreaterThan(MODAL_STACK_BASE_Z_INDEX);
  });
});
