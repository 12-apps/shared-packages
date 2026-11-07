// @vitest-environment jsdom
/**
 * FUT-4416 UI review: a row the buyer opens on a phone is scrolled clear of
 * the pinned bar as measured. jsdom has no layout, so the measuring is tested
 * on boxes, and `revealRow` on a stubbed `getBoundingClientRect`.
 */
import { describe, expect, it, vi } from "vitest";

import { ROW_TO_BAR_GAP, barClearance, revealRow, type RowBox } from "../list/reveal-row";

const ROW: RowBox = { top: 400, bottom: 540, left: 16, right: 374 };

describe("barClearance", () => {
  it("is the height the bar hides at the bottom of the screen", () => {
    expect(barClearance(ROW, { top: 508, bottom: 844, left: 0, right: 390 }, 844)).toBe(336);
  });

  it("follows the bar as it grows", () => {
    expect(barClearance(ROW, { top: 318, bottom: 844, left: 0, right: 390 }, 844)).toBe(526);
  });

  it("is 0 with no bar", () => {
    expect(barClearance(ROW, null, 844)).toBe(0);
  });

  it("is 0 for a bar beside the row (the computer's column)", () => {
    expect(barClearance({ top: 400, bottom: 540, left: 24, right: 760 }, { top: 120, bottom: 700, left: 800, right: 1256 }, 800)).toBe(0);
  });

  it("is 0 for a bar below the screen", () => {
    expect(barClearance(ROW, { top: 900, bottom: 1200, left: 0, right: 390 }, 844)).toBe(0);
  });

  it("never counts more than the screen for a bar whose top is above it", () => {
    expect(barClearance(ROW, { top: -20, bottom: 844, left: 0, right: 390 }, 844)).toBe(844);
  });
});

describe("revealRow", () => {
  it("scrolls the row to the nearest edge, its bottom clear of the measured bar, and restores its margin", () => {
    // The row and the bar in a container of the test's own: the bar is found
    // through the row's document, so it is queried there and the container
    // is removed afterwards.
    const container = document.createElement("div");
    const row = document.createElement("div");
    const bar = document.createElement("div");
    bar.setAttribute("data-testid", "list-pay-bar");
    container.append(row, bar);
    document.body.append(container);
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ ...ROW, x: 16, y: 400, width: 358, height: 140, toJSON: () => ({}) });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({ top: 508, bottom: 844, left: 0, right: 390, x: 0, y: 508, width: 390, height: 336, toJSON: () => ({}) });
    const marginsAtScroll: string[] = [];
    const scroll = vi.fn(() => {
      marginsAtScroll.push(row.style.scrollMarginBottom);
    });
    Object.defineProperty(row, "scrollIntoView", { value: scroll });
    // A 390×844 phone: the bar's top at 508 hides its bottom 336px.
    revealRow(row, 844);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(marginsAtScroll).toEqual([`${336 + ROW_TO_BAR_GAP}px`]);
    expect(row.style.scrollMarginBottom).toBe("");
    container.remove();
  });

  it("does nothing where there is no layout to scroll", () => {
    const row = document.createElement("div");
    Object.defineProperty(row, "scrollIntoView", { value: undefined });
    expect(() => revealRow(row, 844)).not.toThrow();
  });
});
