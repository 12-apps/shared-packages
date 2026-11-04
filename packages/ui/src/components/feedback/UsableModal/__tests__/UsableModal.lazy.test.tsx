/**
 * Only the surface a viewport draws is ever loaded. Its own file, so its own
 * module registry: nothing an earlier test rendered has loaded either surface.
 */
import { cleanup, render, screen } from "@testing-library/react";
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

import { UsableModal } from "../UsableModal";

/** `useMediaQuery(down('sm'))` asks a `max-width` query: false on a computer. */
function stubComputer(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: false,
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

describe("UsableModal — each surface is loaded on demand", () => {
  it("loads nothing while closed, and only the computer's surface once open", async () => {
    stubComputer();
    const base = { open: false, onClose: vi.fn(), title: "New order", backLabel: "Back", dataTestId: "um" };

    const view = render(<UsableModal {...base} />);
    expect(loaded).toEqual({ modal: 0, sheet: 0 });

    view.rerender(<UsableModal {...base} open />);
    await screen.findByTestId("um-title");
    expect(loaded).toEqual({ modal: 1, sheet: 0 });
  });
});
