// @vitest-environment jsdom
/**
 * FUT-3591 code review round 2:
 *
 *  - the saved-card chips are ONE Tab stop; the arrows, Home and End move and
 *    select, as a radio group's do.
 *
 * (A Google Pay choice used to survive a moment without a price, on a held,
 * spinning button. The host's review withdrew that: no price is no row — see
 * `payment-list-credit.test.tsx`.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { SAVED_MASTER, SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  delete (window as { google?: unknown }).google;
  cleanup();
});

describe("the saved-card chips", () => {
  it("are one Tab stop: only the checked chip is tabbable", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA, SAVED_MASTER]) });
    await waitFor(() => {
      expect(screen.getByTestId("list-card-vault-1").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByTestId("list-card-vault-1").getAttribute("tabindex")).toBe("0");
      expect(screen.getByTestId("list-card-vault-2").getAttribute("tabindex")).toBe("-1");
      expect(screen.getByTestId("list-card-new").getAttribute("tabindex")).toBe("-1");
    });
  });

  it("move and select with the arrows, Home and End, wrapping at the ends", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA, SAVED_MASTER]) });
    const first = await screen.findByTestId("list-card-vault-1");
    await waitFor(() => expect(first.getAttribute("aria-checked")).toBe("true"));
    const press = async (key: string, expected: string) => {
      // From the group's one Tab stop — the chip the keyboard is on.
      const stop = document.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? first;
      fireEvent.keyDown(stop, { key });
      await waitFor(() => {
        const chip = screen.getByTestId(expected);
        expect(chip.getAttribute("aria-checked")).toBe("true");
        expect(chip.getAttribute("tabindex")).toBe("0");
        expect(document.activeElement).toBe(chip);
      });
    };
    await press("ArrowRight", "list-card-vault-2");
    await press("ArrowDown", "list-card-new");
    await press("ArrowRight", "list-card-vault-1");
    await press("ArrowLeft", "list-card-new");
    await press("Home", "list-card-vault-1");
    await press("End", "list-card-new");
    await press("ArrowUp", "list-card-vault-2");
  });

  it("draw the rows' 2px primary ring on the chip the keyboard is on", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA, SAVED_MASTER]) });
    const first = await screen.findByTestId("list-card-vault-1");
    await waitFor(() => expect(first.getAttribute("aria-checked")).toBe("true"));
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByTestId("list-card-vault-2");
    await waitFor(() => expect(second.classList.contains("Mui-focusVisible")).toBe(true));
    const style = getComputedStyle(second);
    expect(style.outlineStyle || style.outline).toContain("solid");
    expect(getComputedStyle(first).outlineStyle || "").not.toContain("solid");
  });
});
