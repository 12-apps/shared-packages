/* eslint-disable test-flakiness/no-test-isolation -- `mocks` is the navigator
   stub container, REPLACED wholesale in `beforeEach`, which is what the rule
   asks for; it flags the per-case reassignment anyway. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { needsPullToRefresh, reloadApp } from "../reload";

/**
 * The reload an installed app took away (12-61).
 *
 * Every case here is a variation on one rule: **a reload the user asked for is
 * never something the app declines to do.** No worker, no support, an update
 * that rejects, a network that never answers — each still reloads. The
 * service-worker update in front of it is an optimisation for the deploy case
 * and must never become a precondition.
 */
const mocks = {
  getRegistration: vi.fn(),
  update: vi.fn(),
  reload: vi.fn(),
};

/**
 * Reads `mocks` THROUGH the container on every call, rather than capturing the
 * function it holds right now. Capturing is the trap: a case that swaps in a
 * rejecting `getRegistration` would still be answered by the one `beforeEach`
 * installed, and would pass while asserting nothing.
 */
function installNavigator(): void {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: () => mocks.getRegistration() },
  });
}

function setDisplayMode(standalone: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: standalone && query.includes("standalone") }),
  });
}

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.update = vi.fn().mockResolvedValue(undefined);
  mocks.getRegistration = vi.fn().mockResolvedValue({ update: mocks.update });
  mocks.reload = vi.fn();
  installNavigator();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload: mocks.reload },
  });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("needsPullToRefresh", () => {
  it("is true for an installed app on iOS — the one place with no reload at all", () => {
    setDisplayMode(true);
    setUserAgent(IPHONE);
    expect(needsPullToRefresh()).toBe(true);
  });

  it("is false in an iOS browser tab, which has an address bar and its own pull", () => {
    setDisplayMode(false);
    setUserAgent(IPHONE);
    expect(needsPullToRefresh()).toBe(false);
  });

  it("is false for an installed app on Android, which KEEPS its overscroll refresh", () => {
    // A second gesture on top of a working one is how one pull reloads twice.
    setDisplayMode(true);
    setUserAgent(ANDROID);
    expect(needsPullToRefresh()).toBe(false);
  });
});

describe("reloadApp", () => {
  it("asks the worker to update before reloading, so a deploy is picked up", async () => {
    await reloadApp();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when the update rejects — offline is not a reason to refuse", async () => {
    mocks.update = vi.fn().mockRejectedValue(new Error("offline"));
    mocks.getRegistration = vi.fn().mockResolvedValue({ update: mocks.update });
    await reloadApp();
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when there is no registration at all", async () => {
    mocks.getRegistration = vi.fn().mockResolvedValue(undefined);
    await reloadApp();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads in a browser with no service-worker support", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    await reloadApp();
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it("does not wait past the timeout for an update that never answers", async () => {
    // The person who just pulled down is usually the person whose network is
    // having a bad day. A spinner that never ends is the worse failure.
    mocks.update = vi.fn().mockReturnValue(new Promise(() => {}));
    mocks.getRegistration = vi.fn().mockResolvedValue({ update: mocks.update });
    const pending = reloadApp({ timeoutMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
});
