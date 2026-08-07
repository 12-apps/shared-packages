/**
 * The noise filter (FUT-719) — the half that decides whether anyone keeps the
 * tab open.
 *
 * These cases are weighted towards things that must NOT be reported, and that
 * asymmetry is the point. A missed bug costs one diagnosis; a reporter that
 * files an issue for every open tab on every deploy gets muted, and a muted
 * reporter still bills while catching nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetErrorClassifiersForTests,
  setErrorClassifiers,
  shouldReport,
  SOURCE_ROUTE_BOUNDARY,
} from "../noise";

/**
 * A stand-in for the host's HTTP error type.
 *
 * The package no longer imports the app's `ApiError` — knowing what a routine
 * non-5xx answer looks like is the HOST's business, injected as a classifier.
 * Declaring a local double here is what proves the seam: these cases exercise
 * the noise RULE, not one product's error class.
 */
class ResponseError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

beforeEach(() => {
  setErrorClassifiers({
    isIgnorableResponse: (error) => error instanceof ResponseError && error.status < 500,
  });
});

afterEach(resetErrorClassifiersForTests);

/** The filter reads `text` for message matching; build it the way the SDK does. */
function ctx(text: string, source?: string): { text: string; source?: string } {
  return source === undefined ? { text } : { text, source };
}

describe("shouldReport", () => {
  describe("stale chunks after a deploy", () => {
    // Every hashed filename dies with the deploy that produced it, so EVERY tab
    // opened beforehand requests a chunk that is gone. `lazy-route.ts` recovers
    // by reloading. Reporting that would file one issue per open tab per
    // deploy, and the storefront is installable — its tabs live for days.
    const chunkError = new Error("Failed to fetch dynamically imported module: /assets/x.js");

    it("drops one that has not been through recovery", () => {
      const decision = shouldReport(chunkError, ctx(chunkError.message));
      expect(decision.report).toBe(false);
      expect(decision.reason).toBe("stale-chunk-recovered");
    });

    it("REPORTS one that reached the route boundary", () => {
      // `loadRouteChunk` swallows the first failure and reloads, returning a
      // promise that never settles. So a chunk error arriving at the boundary
      // has already survived that recovery: the reload did not fix it, which
      // is a genuinely missing chunk rather than a stale tab.
      expect(
        shouldReport(chunkError, ctx(chunkError.message, SOURCE_ROUTE_BOUNDARY)).report,
      ).toBe(true);
    });

    it("recognises the wording each browser uses", () => {
      // Browsers disagree and the failure arrives as a plain Error, so the
      // message is all there is to match on.
      for (const message of [
        "Importing a module script failed",
        "Unable to preload CSS for /assets/x.css",
        "Failed to fetch dynamically imported module",
      ]) {
        expect(shouldReport(new Error(message), ctx(message)).report).toBe(false);
      }
    });
  });

  describe("API responses", () => {
    it("drops a clean 4xx", () => {
      // `apiFetch` throws for any non-2xx, so an empty cart (400 EMPTY_CART)
      // arrives looking exactly like a crash. Same rule a server-side
      // reporter needs: a clean 4xx is not an error.
      const decision = shouldReport(
        new ResponseError(400),
        ctx("EMPTY_CART"),
      );
      expect(decision.report).toBe(false);
      expect(decision.reason).toBe("client-error-response");
    });

    it("drops 401 and 404, which are routine in a SPA", () => {
      expect(shouldReport(new ResponseError(401), ctx("unauthorized")).report).toBe(false);
      expect(shouldReport(new ResponseError(404), ctx("not found")).report).toBe(false);
    });

    it("reports a 5xx", () => {
      expect(shouldReport(new ResponseError(500), ctx("server error")).report).toBe(true);
    });
  });

  describe("code that is not ours", () => {
    it("drops ResizeObserver loop noise", () => {
      const message = "ResizeObserver loop completed with undelivered notifications.";
      expect(shouldReport(new Error(message), ctx(message)).report).toBe(false);
    });

    it("drops an opaque cross-origin 'Script error.'", () => {
      // No stack, no file — it groups everything unrelated under one heading.
      expect(shouldReport(null, ctx("Script error.")).report).toBe(false);
    });

    it("drops a throw whose stack is inside a browser extension", () => {
      const message = "undefined is not a function";
      const decision = shouldReport(
        new Error(message),
        ctx(`${message} chrome-extension://abcdef/inject.js`),
      );
      expect(decision.report).toBe(false);
      expect(decision.reason).toBe("not-our-code");
    });
  });

  it("reports an ordinary application bug", () => {
    // The control. If this ever goes false the filter has eaten the feature.
    const error = new TypeError("Cannot read properties of undefined (reading 'total')");
    expect(shouldReport(error, ctx(error.message)).report).toBe(true);
  });
});
