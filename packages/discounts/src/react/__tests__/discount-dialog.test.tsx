// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscountDialog } from "../discount-dialog";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";

/**
 * The surface the create and edit forms open in (FUT-4417; owner, 2026-11-05:
 * "Substitui o modal pelo stacked modal no desktop"): a stacked modal on a
 * computer, so the combo form has room for its preview column, and a bottom
 * sheet on a phone.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;

/**
 * Each surface is a lazily imported chunk, and its FIRST import in a test file
 * compiles the whole stacked modal or sheet. On a loaded CI runner that took
 * 1.2 s, past `findBy`'s 1 s default, and reddened `main` once.
 */
const SURFACE_LOADED = { timeout: 10_000 };

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

function Harness(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen((was) => !was)}>
        toggle
      </button>
      <DiscountDialog open={open} onClose={() => setOpen(false)} title="Novo desconto" copy={copy}>
        <input aria-label="Nome" defaultValue="" />
      </DiscountDialog>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the discount dialog", () => {
  it("D1: on a computer it is a stacked modal, named by its title, with the pack's ✕", async () => {
    stubViewport(false);
    render(<Harness />);
    expect(
      (await screen.findByTestId("discount-dialog-title", {}, SURFACE_LOADED)).textContent,
    ).toBe("Novo desconto");
    expect(screen.getByRole("dialog", { name: "Novo desconto" })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.form.dialog.close })).toBeTruthy();
  });

  it("D2: on a phone it is a bottom sheet, named by its title", async () => {
    stubViewport(true);
    render(<Harness />);
    expect(
      (await screen.findByTestId("discount-dialog-header-title", {}, SURFACE_LOADED)).textContent,
    ).toBe("Novo desconto");
    await waitFor(() => expect(screen.queryByTestId("discount-dialog-title")).toBeNull());
  });

  it("D3: reopened while it is still leaving, the form starts empty again", async () => {
    stubViewport(true);
    render(<Harness />);
    const typed = (await screen.findByLabelText("Nome", {}, SURFACE_LOADED)) as HTMLInputElement;
    fireEvent.change(typed, { target: { value: "5 marmitas" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "toggle", hidden: true }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "toggle", hidden: true }));
    });
    await waitFor(() => expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe(""));
  });
});
