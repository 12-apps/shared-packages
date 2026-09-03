/**
 * The gesture, asserted without a renderer.
 *
 * That split is the whole reason `pull-gesture.ts` is framework-free: every
 * case below is a finger doing something a user's finger does, and expressing
 * them as `{x, y}` points costs nothing where fabricating `TouchEvent`s and a
 * scroll container would dominate the file.
 */
import { describe, expect, it } from "vitest";

import {
  createPullTracker,
  DEFAULT_PULL_GEOMETRY,
  documentAtTop,
  PULL_REFRESH_OPT_OUT_ATTR,
  pullBlockedBy,
  resistPull,
} from "../pull-gesture";

const { engagePx, thresholdPx, maxPx } = DEFAULT_PULL_GEOMETRY;

/** Finger travel that renders exactly `distance` px, inverting `resistPull`. */
function travelFor(distance: number): number {
  return (distance * maxPx) / (maxPx - distance);
}

describe("resistPull", () => {
  it("is roughly 1:1 for the first pixels, so the chip feels attached", () => {
    expect(resistPull(4, maxPx)).toBeGreaterThan(3.8);
    expect(resistPull(4, maxPx)).toBeLessThanOrEqual(4);
  });

  it("approaches the maximum without ever reaching it", () => {
    expect(resistPull(10_000, maxPx)).toBeLessThan(maxPx);
    expect(resistPull(10_000, maxPx)).toBeGreaterThan(maxPx * 0.98);
  });

  it("renders nothing for a finger that has not moved down", () => {
    expect(resistPull(0, maxPx)).toBe(0);
    expect(resistPull(-50, maxPx)).toBe(0);
  });

  it("arms at the travel the defaults were picked from", () => {
    expect(travelFor(thresholdPx)).toBeCloseTo(137.1, 1);
  });
});

describe("createPullTracker", () => {
  it("watches the first pixels without consuming them", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 0 });
    const update = tracker.move({ x: 0, y: engagePx - 1 });
    expect(update.claimed).toBe(false);
    expect(update.distance).toBe(0);
  });

  it("claims the gesture once the pull is unmistakable", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 0 });
    const update = tracker.move({ x: 0, y: engagePx + 1 });
    expect(update.claimed).toBe(true);
    expect(update.phase).toBe("pulling");
  });

  it("stands down for a sideways swipe — a rail keeps its gesture", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 0 });
    expect(tracker.move({ x: 90, y: 40 }).claimed).toBe(false);
    // And having stood down, it cannot claim the rest of the same drag.
    expect(tracker.move({ x: 90, y: 400 }).claimed).toBe(false);
  });

  it("stands down for a finger moving up — an ordinary scroll", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 100 });
    expect(tracker.move({ x: 0, y: 40 }).claimed).toBe(false);
  });

  it("arms past the threshold and refreshes on release", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 0 });
    const update = tracker.move({ x: 0, y: travelFor(thresholdPx) + 1 });
    expect(update.phase).toBe("armed");
    expect(tracker.release()).toBe(true);
  });

  it("does not refresh when released short of the threshold", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 0 });
    expect(tracker.move({ x: 0, y: travelFor(thresholdPx) - 20 }).phase).toBe("pulling");
    expect(tracker.release()).toBe(false);
  });

  it("keeps a claimed gesture even when the finger turns sideways", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 0 });
    tracker.move({ x: 0, y: engagePx + 5 });
    // Handing the page back mid-drag is what reads as a bug.
    expect(tracker.move({ x: 300, y: engagePx + 6 }).claimed).toBe(true);
  });

  it("shrinks to nothing rather than disowning a claimed gesture dragged back up", () => {
    const tracker = createPullTracker();
    tracker.begin({ x: 0, y: 0 });
    tracker.move({ x: 0, y: 200 });
    const back = tracker.move({ x: 0, y: -50 });
    expect(back.claimed).toBe(true);
    expect(back.distance).toBe(0);
    expect(tracker.release()).toBe(false);
  });

  it("answers idle for a move with no begin, and forgets a cancelled gesture", () => {
    const tracker = createPullTracker();
    expect(tracker.move({ x: 0, y: 500 }).claimed).toBe(false);
    tracker.begin({ x: 0, y: 0 });
    tracker.move({ x: 0, y: 500 });
    tracker.cancel();
    expect(tracker.release()).toBe(false);
  });
});

describe("pullBlockedBy", () => {
  function scroller(scrollTop: number, scrollHeight: number): HTMLElement {
    const element = document.createElement("div");
    Object.defineProperty(element, "scrollTop", { value: scrollTop, configurable: true });
    Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(element, "clientHeight", { value: 100, configurable: true });
    return element;
  }

  it("stands down inside a list that is scrolled down", () => {
    const host = document.createElement("div");
    const list = scroller(40, 900);
    const row = document.createElement("span");
    list.append(row);
    host.append(list);
    expect(pullBlockedBy(row, host)).toBe(true);
  });

  it("takes the gesture when the nested list is already at its top", () => {
    const host = document.createElement("div");
    const list = scroller(0, 900);
    const row = document.createElement("span");
    list.append(row);
    host.append(list);
    expect(pullBlockedBy(row, host)).toBe(false);
  });

  it("honours the opt-out attribute", () => {
    const host = document.createElement("div");
    const region = document.createElement("div");
    region.setAttribute(PULL_REFRESH_OPT_OUT_ATTR, "off");
    const child = document.createElement("span");
    region.append(child);
    host.append(region);
    expect(pullBlockedBy(child, host)).toBe(true);
  });

  it("is not blocked by anything, for a target that is not an element", () => {
    expect(pullBlockedBy(null, document.createElement("div"))).toBe(false);
  });
});

describe("documentAtTop", () => {
  it("is true at the top of the document and false below it", () => {
    const root = document.scrollingElement ?? document.documentElement;
    Object.defineProperty(root, "scrollTop", { value: 0, configurable: true });
    expect(documentAtTop()).toBe(true);
    Object.defineProperty(root, "scrollTop", { value: 120, configurable: true });
    expect(documentAtTop()).toBe(false);
  });
});
