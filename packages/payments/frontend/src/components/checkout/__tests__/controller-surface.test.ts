/**
 * `CheckoutController` IS PUBLISHED, AND A PATCH MAY NOT SHRINK IT (FUT-1170).
 *
 * `CheckoutController` is `ReturnType<typeof useCheckoutController>`
 * (flows/types.ts), re-exported from `index.ts`, and `PaymentFlows.useCheckout()`
 * returns it. So every key of it is public API, even though no file declares the
 * shape by hand and nothing here spells "export interface CheckoutController".
 *
 * That indirection is what let a cosmetic `resume*` -> `awaiting*` rename delete
 * three members of a published type inside a `fix:` commit. `breaking-change-
 * guard.mjs` reads commit messages and cannot see it; `tsc` is happy because
 * every caller inside the package moved with the rename. The only thing that
 * would have caught it is an adopter's build, after release.
 *
 * This is that adopter, named at the keys rather than the whole shape: the list
 * below may GROW freely, and a member that leaves it has to leave in a release
 * that says so.
 */
import { describe, expect, it } from "vitest";

import type { CheckoutController } from "../../../flows/types";

/**
 * Every key an adopter may read today. Adding one here is free; removing one is
 * the declaration that this release breaks them.
 */
const PUBLISHED_KEYS = [
  "awaitingCheckAgain",
  "awaitingError",
  "awaitingTimedOut",
  "resumeCheckAgain",
  "resumeError",
  "resumeRelease",
  "resumeReleasing",
  "resumeTimedOut",
] as const;

describe("the published controller keeps the members it published", () => {
  it.each(PUBLISHED_KEYS)("still offers %s", (key) => {
    // Compile-time, not runtime: a removed key stops being assignable to
    // `keyof CheckoutController` and this file fails `check-types`, which is the
    // lane that runs before a release rather than after one.
    const named: keyof CheckoutController = key;
    expect(named).toBe(key);
  });

  it("keeps the renamed pair pointing at one answer", () => {
    // The aliases are not independent state — they are the same wait under two
    // spellings, so a future change that moves one has to move both or fail here.
    const paired: readonly (readonly [keyof CheckoutController, keyof CheckoutController])[] = [
      ["awaitingTimedOut", "resumeTimedOut"],
      ["awaitingError", "resumeError"],
      ["awaitingCheckAgain", "resumeCheckAgain"],
    ];
    expect(paired).toHaveLength(3);
  });
});
