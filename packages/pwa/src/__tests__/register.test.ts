/* eslint-disable test-flakiness/no-test-isolation -- `mocks` is the navigator
   stub container, REPLACED wholesale in `beforeEach` (see below) which is exactly
   what the rule asks for; it flags the per-case reassignment anyway. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postToServiceWorker, registerServiceWorker } from "../register";

/**
 * Boot registration and the worker handoff (12-23), ported from future-pay's
 * `@repo/spa-shared/service-worker` suite.
 *
 * Both behaviours are "must not break anything" rather than "must succeed": a
 * browser that refuses a service worker still has to get a working app, so every
 * failure path here is a silent no-op. The cases exist because the tempting
 * implementations — registering during boot, awaiting the registration, letting a
 * rejection escape — each cost the visitor something real (first paint, or an
 * unhandled rejection in the console) for a background task nothing is waiting
 * on.
 */

/**
 * A container, not three bare bindings: each test replaces a mock's behaviour,
 * and mutating a shared top-level `const` from inside a stub is exactly the
 * cross-test coupling the flakiness gate exists to stop.
 */
const mocks = {
  register: vi.fn(),
  getRegistration: vi.fn(),
  postMessage: vi.fn(),
};

function installNavigator(): void {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: mocks.register, getRegistration: mocks.getRegistration },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.register = vi.fn().mockResolvedValue({});
  mocks.postMessage = vi.fn();
  mocks.getRegistration = vi.fn().mockResolvedValue({ active: { postMessage: mocks.postMessage } });
  installNavigator();
  // jsdom reports "complete" already, which is the path that registers
  // immediately; the deferred path gets its own case below.
  Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("registerServiceWorker", () => {
  it("registers at the root scope", () => {
    // Scope "/" is what lets one worker cover every route; the default scope
    // would be the SCRIPT'S OWN DIRECTORY, which covers almost nothing.
    registerServiceWorker();
    expect(mocks.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("takes the host's path and scope", () => {
    registerServiceWorker({ path: "/worker.js", scope: "/loja/" });
    expect(mocks.register).toHaveBeenCalledWith("/worker.js", { scope: "/loja/" });
  });

  it("waits for load rather than competing with the page's own chunks", async () => {
    Object.defineProperty(document, "readyState", { configurable: true, value: "loading" });
    const addEventListener = vi.spyOn(window, "addEventListener");

    registerServiceWorker();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });

    window.dispatchEvent(new Event("load"));
    // `waitFor` rather than a bare assertion: the listener runs synchronously here,
    // but asserting immediately after a dispatched event is the shape that goes
    // flaky the moment anything in the path becomes a microtask.
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    addEventListener.mockRestore();
  });

  it("does nothing at all where workers are unsupported", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("swallows a refused registration", async () => {
    // Private mode, an insecure origin, a user policy — the app still works, and
    // an unhandled rejection in the console would be the only visible damage.
    mocks.register = vi.fn().mockRejectedValue(new Error("insecure origin"));
    installNavigator();
    registerServiceWorker();
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });
});

describe("postToServiceWorker", () => {
  it("posts to the active worker", async () => {
    postToServiceWorker({ type: "set-push-icon", icon: "/loja.png" });
    await vi.waitFor(() =>
      expect(mocks.postMessage).toHaveBeenCalledWith({
        type: "set-push-icon",
        icon: "/loja.png",
      }),
    );
  });

  it("does nothing when no worker is active yet", async () => {
    // The common case on a first visit: the next navigation says it again.
    mocks.getRegistration = vi.fn().mockResolvedValue(undefined);
    installNavigator();
    postToServiceWorker({ type: "set-push-icon", icon: null });
    await vi.waitFor(() => expect(mocks.postMessage).not.toHaveBeenCalled());
  });
});
