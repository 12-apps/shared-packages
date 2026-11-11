/**
 * `revealDelta` is pure and carries the three outcomes; `revealBlock` and
 * `followBlock` are checked against stood-in geometry, since jsdom lays nothing out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { followBlock, revealBlock, revealDelta } from "./reveal-block";

const VIEW = { top: 0, bottom: 600 };

describe("revealDelta", () => {
  it("is 0 for a block already whole in view", () => {
    expect(revealDelta({ top: 100, bottom: 300 }, VIEW)).toBe(0);
    expect(revealDelta({ top: 0, bottom: 600 }, VIEW)).toBe(0);
  });

  it("puts the end of a block that fits 12px above the view's end", () => {
    // Ends at 700, 100 below the view: scroll down 100 plus the 12px gap.
    expect(revealDelta({ top: 500, bottom: 700 }, VIEW)).toBe(112);
  });

  it("scrolls up to a block that starts above the view, and fits", () => {
    // The bottom is in view but the top is cut: the end rule applies and moves up.
    expect(revealDelta({ top: -50, bottom: 150 }, VIEW)).toBe(150 - (600 - 12));
  });

  it("puts the top of a block taller than the view 12px under the view's top", () => {
    expect(revealDelta({ top: 300, bottom: 1300 }, VIEW)).toBe(300 - 12);
  });

  it("takes the gap as a parameter", () => {
    expect(revealDelta({ top: 500, bottom: 700 }, VIEW, 0)).toBe(100);
    expect(revealDelta({ top: 300, bottom: 1300 }, VIEW, 0)).toBe(300);
  });
});

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}

function setMotion(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
    })),
  );
}

describe("revealBlock", () => {
  let scrollBy: ReturnType<typeof vi.spyOn>;
  let box: HTMLElement;

  beforeEach(() => {
    scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    setMotion(false);
    box = document.createElement("div");
    document.body.append(box);
  });

  afterEach(() => {
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function place(top: number, bottom: number): void {
    box.getBoundingClientRect = () => rect(top, bottom);
  }

  it("does not move the page for a block already in view", () => {
    place(100, 300);
    revealBlock(box);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("measures nothing for a block with no box: no ancestor style, no inset", () => {
    place(0, 0);
    const styles = vi.spyOn(window, "getComputedStyle");
    const topInset = vi.fn(() => 64);
    revealBlock(box, { topInset });
    expect(styles).not.toHaveBeenCalled();
    expect(topInset).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("does nothing for null", () => {
    expect(() => revealBlock(null)).not.toThrow();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("keeps the block's end above a bottom inset, given as a number", () => {
    place(500, 780);
    revealBlock(box, { bottomInset: 100 });
    // The view ends at 700: 780 - (700 - 12).
    expect(scrollBy).toHaveBeenCalledWith({ top: 92, behavior: "smooth" });
  });

  it("reads a function inset at every reveal", () => {
    place(500, 790);
    let bar = 0;
    revealBlock(box, { bottomInset: () => bar });
    expect(scrollBy).not.toHaveBeenCalled();
    bar = 100;
    revealBlock(box, { bottomInset: () => bar });
    // The view now ends at 700: 790 - (700 - 12).
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 102, behavior: "smooth" });
  });

  it("puts a block taller than the view under the top inset", () => {
    place(300, 1900);
    revealBlock(box, { topInset: 64 });
    expect(scrollBy).toHaveBeenCalledWith({ top: 300 - (64 + 12), behavior: "smooth" });
  });

  it("ignores a negative or non-finite inset", () => {
    place(500, 900);
    revealBlock(box, { bottomInset: () => Number.NaN, topInset: -40 });
    expect(scrollBy).toHaveBeenCalledWith({ top: 900 - (800 - 12), behavior: "smooth" });
  });

  it("scrolls instantly when the visitor prefers reduced motion", () => {
    setMotion(true);
    place(500, 900);
    revealBlock(box);
    expect(scrollBy).toHaveBeenCalledWith({ top: 112, behavior: "auto" });
  });

  it("scrolls the nearest scrolling ancestor, not the page", () => {
    const pane = document.createElement("div");
    pane.style.overflowY = "auto";
    Object.defineProperty(pane, "scrollHeight", { value: 2000 });
    Object.defineProperty(pane, "clientHeight", { value: 400 });
    pane.getBoundingClientRect = () => rect(100, 500);
    const paneScroll = vi.fn();
    pane.scrollBy = paneScroll as unknown as typeof pane.scrollBy;
    document.body.append(pane);
    pane.append(box);
    place(450, 560);
    revealBlock(box);
    expect(paneScroll).toHaveBeenCalledWith({ top: 560 - (500 - 12), behavior: "smooth" });
    expect(scrollBy).not.toHaveBeenCalled();
    pane.remove();
  });
});

describe("followBlock", () => {
  type Callback = () => void;
  let observers: { callback: Callback; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }[];
  let box: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    observers = [];
    vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    setMotion(false);
    class FakeResizeObserver {
      private readonly entry: (typeof observers)[number];
      constructor(callback: Callback) {
        this.entry = { callback, observed: [], disconnect: vi.fn() };
        observers.push(this.entry);
      }
      observe(el: Element): void {
        this.entry.observed.push(el);
      }
      disconnect(): void {
        this.entry.disconnect();
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    box = document.createElement("div");
    box.getBoundingClientRect = () => rect(100, 200);
    document.body.append(box);
  });

  afterEach(() => {
    box.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a no-op for null", () => {
    expect(followBlock(null)).toBeInstanceOf(Function);
    expect(observers).toHaveLength(0);
  });

  it("watches the block and the bars it is given, and stops when called", () => {
    const bar = document.createElement("div");
    const stop = followBlock(box, { watch: [bar, null] });
    expect(observers[0]?.observed).toEqual([box, bar]);
    stop();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  it("re-reveals when a watched element resizes, and stops by itself after settleMs", () => {
    const tall = document.createElement("div");
    tall.getBoundingClientRect = () => rect(500, 900);
    document.body.append(tall);
    followBlock(tall, { settleMs: 500 });
    expect(window.scrollBy).toHaveBeenCalledTimes(1);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    observers[0]?.callback();
    expect(window.scrollBy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(observers[0]?.disconnect).toHaveBeenCalled();
    tall.remove();
  });
});
