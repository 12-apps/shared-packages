// @vitest-environment jsdom
/**
 * FUT-4416 UI review: a row the buyer opens on a phone is scrolled clear of
 * the pinned bar as measured. jsdom has no layout, so the measuring is tested
 * on boxes, and `revealRow` on a stubbed `getBoundingClientRect`.
 */
import { describe, expect, it, vi } from "vitest";

import { ROW_TO_BAR_GAP, SETTLE_MS, barClearance, keepRowClear, revealRow, type RowBox, type SettleDeps } from "../list/reveal-row";

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

  it("puts a row taller than the room above the bar at the top of the screen", () => {
    const container = document.createElement("div");
    const row = document.createElement("div");
    const bar = document.createElement("div");
    bar.setAttribute("data-testid", "list-pay-bar");
    container.append(row, bar);
    document.body.append(container);
    // A 320×640 phone: 208px of row, and the bar's top at 192.
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 300, bottom: 508, left: 16, right: 304, x: 16, y: 300, width: 288, height: 208, toJSON: () => ({}) });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({ top: 192, bottom: 640, left: 0, right: 320, x: 0, y: 192, width: 320, height: 448, toJSON: () => ({}) });
    const scroll = vi.fn();
    Object.defineProperty(row, "scrollIntoView", { value: scroll });
    revealRow(row, 640);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(row.style.scrollMarginBottom).toBe("");
    container.remove();
  });

  it("does nothing where there is no layout to scroll", () => {
    const row = document.createElement("div");
    Object.defineProperty(row, "scrollIntoView", { value: undefined });
    expect(() => revealRow(row, 844)).not.toThrow();
  });

  it("does nothing for a row with no box, as in jsdom, whatever the frame timing", () => {
    const row = document.createElement("div");
    const scroll = vi.fn();
    Object.defineProperty(row, "scrollIntoView", { value: scroll });
    revealRow(row, 844);
    expect(scroll).not.toHaveBeenCalled();
  });
});

/**
 * The bar grows a render or more after the press (the host's nudges arrive
 * through its own state): the row is revealed again on each size the bar
 * takes, until the buyer scrolls or the settle window ends.
 */
describe("keepRowClear", () => {
  /** A fake browser: the observer, the timer and the buyer's scroll are fired by the test. */
  function fakeDeps() {
    const resized: (() => void)[] = [];
    const timers: { ms: number; done: () => void }[] = [];
    const scrolls: (() => void)[] = [];
    const observed: Element[][] = [];
    const ended = { observer: 0, timer: 0, scroll: 0 };
    const deps: SettleDeps = {
      observe: (targets, onResize) => {
        observed.push([...targets]);
        resized.push(onResize);
        return () => { ended.observer += 1; };
      },
      after: (ms, done) => {
        timers.push({ ms, done });
        return () => { ended.timer += 1; };
      },
      onUserScroll: (scrolled) => {
        scrolls.push(scrolled);
        return () => { ended.scroll += 1; };
      },
    };
    return { deps, resized, timers, scrolls, observed, ended };
  }

  function rowAndBar() {
    const container = document.createElement("div");
    const row = document.createElement("div");
    const bar = document.createElement("div");
    bar.setAttribute("data-testid", "list-pay-bar");
    container.append(row, bar);
    document.body.append(container);
    return { row, bar, release: () => container.remove() };
  }

  it("reveals at once, observes the row and the bar, and reveals again on each resize", () => {
    const { row, bar, release } = rowAndBar();
    const fake = fakeDeps();
    const reveal = vi.fn();
    keepRowClear(row, reveal, fake.deps);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(fake.observed).toEqual([[row, bar]]);
    fake.resized[0]!();
    fake.resized[0]!();
    expect(reveal).toHaveBeenCalledTimes(3);
    release();
  });

  it("stops after the settle window: a later resize reveals nothing, and everything is released", () => {
    const { row, release } = rowAndBar();
    const fake = fakeDeps();
    const reveal = vi.fn();
    keepRowClear(row, reveal, fake.deps);
    expect(fake.timers.map((timer) => timer.ms)).toEqual([SETTLE_MS]);
    fake.timers[0]!.done();
    fake.resized[0]!();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(fake.ended).toEqual({ observer: 1, timer: 1, scroll: 1 });
    release();
  });

  it("stops on the buyer's own scroll, never fighting it", () => {
    const { row, release } = rowAndBar();
    const fake = fakeDeps();
    const reveal = vi.fn();
    keepRowClear(row, reveal, fake.deps);
    fake.scrolls[0]!();
    fake.resized[0]!();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(fake.ended).toEqual({ observer: 1, timer: 1, scroll: 1 });
    release();
  });

  it("the returned stop releases everything once, however often it is called", () => {
    const { row, release } = rowAndBar();
    const fake = fakeDeps();
    const stop = keepRowClear(row, vi.fn(), fake.deps);
    stop();
    stop();
    fake.timers[0]!.done();
    expect(fake.ended).toEqual({ observer: 1, timer: 1, scroll: 1 });
    release();
  });

  it("with no bar on the page observes the row alone", () => {
    const row = document.createElement("div");
    const fake = fakeDeps();
    keepRowClear(row, vi.fn(), fake.deps);
    expect(fake.observed).toEqual([[row]]);
  });
});
