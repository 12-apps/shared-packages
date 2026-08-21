// @vitest-environment node
/**
 * The collection retry policy (FUT-340).
 *
 * Its own suite, and a pure one, because this is where being wrong costs real
 * money in a direction nobody notices for weeks: retry something that already
 * charged and the customer is billed twice; refuse to retry a card that would
 * have worked and the revenue silently stops. Every case below is one row of
 * the taxonomy the ticket specified.
 *
 * The ladder and the cap below are a FIXTURE. What is pinned here is that the
 * three questions are asked in the right order against whatever numbers a host
 * supplies — the numbers themselves are the host's, and its own suite pins
 * those.
 */
import { describe, expect, it } from "vitest";

import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  ProviderRequestError,
} from "@12-apps/payments-backend";

import { BillingConfigError } from "../errors";
import { createChargePolicy } from "../server/charge-policy";

const MAX_ATTEMPTS = 4;

/** A fresh policy per assertion — nothing here holds state, but nothing shared does either. */
function policy() {
  return createChargePolicy({
    maxAttempts: MAX_ATTEMPTS,
    backoffMs: [30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000],
    stopWithoutNewCard: ["INSUFFICIENT_FUNDS"],
  });
}

/** A pre-send network failure — provably never became a charge. */
function refusedConnection(): Error {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });
}

/** On the wire when the response was lost — may or may not have charged. */
function headersTimeout(): Error {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
  });
}

describe("the numbers are the host's, and are checked", () => {
  it("refuses an empty ladder — it would retry immediately, forever", () => {
    expect(() =>
      createChargePolicy({ maxAttempts: 3, backoffMs: [], stopWithoutNewCard: [] }),
    ).toThrow(BillingConfigError);
  });

  it("refuses a non-positive wait", () => {
    expect(() =>
      createChargePolicy({ maxAttempts: 3, backoffMs: [0], stopWithoutNewCard: [] }),
    ).toThrow(BillingConfigError);
  });

  it("refuses a budget that permits no attempt at all", () => {
    expect(() =>
      createChargePolicy({ maxAttempts: 0, backoffMs: [1_000], stopWithoutNewCard: [] }),
    ).toThrow(BillingConfigError);
  });

  it("echoes the cap back, so a host's row guard cannot disagree with it", () => {
    expect(policy().maxAttempts).toBe(MAX_ATTEMPTS);
  });
});

describe("a decline the provider explained", () => {
  it("never retries a stop-without-new-card reason on a timer", () => {
    // The central rule, and it deliberately overrides the provider's own
    // verdict: an acquirer marks no-funds retriable because the holder may top
    // up. That is an argument for chasing them, not for a timer — and on some
    // acquirers a burnt attempt counts against the merchant.
    expect(
      policy().decideAfterDecline({ declineReason: "INSUFFICIENT_FUNDS", declineRetriable: true }, 1),
    ).toEqual({ kind: "STOP", needsNewCard: false });
  });

  it("does not ask for a new card when the card was fine", () => {
    // Replacing a working card fixes nothing. The customer needs to hear "put
    // money in the account", which is what `needsNewCard: false` selects.
    expect(policy().decideAfterDecline({ declineReason: "INSUFFICIENT_FUNDS" }, 1)).toMatchObject({
      needsNewCard: false,
    });
  });

  it("leaves the taxonomy alone for a host that lists nothing", () => {
    // A platform that DOES want to retry no-funds says so by omitting it, and
    // the reason then falls through to the ordinary soft-decline path rather
    // than to a hidden default.
    const permissive = createChargePolicy({
      maxAttempts: 4,
      backoffMs: [1_000],
      stopWithoutNewCard: [],
    });
    expect(permissive.decideAfterDecline({ declineReason: "INSUFFICIENT_FUNDS" }, 1).kind).toBe(
      "RETRY",
    );
  });

  it.each(["INVALID_CARD", "EXPIRED_CARD", "FRAUD_SUSPECTED"] as const)(
    "stops immediately and asks for a new card on %s",
    (declineReason) => {
      expect(policy().decideAfterDecline({ declineReason }, 1)).toEqual({
        kind: "STOP",
        needsNewCard: true,
      });
    },
  );

  it("honours the provider's terminal verdict for reasons the taxonomy cannot express", () => {
    // A cancelled recurring mandate normalizes to CARD_DECLINED — there is no
    // truer value in the union — but the provider says not to try it again, and
    // continuing to present a revoked debit earns chargebacks.
    expect(
      policy().decideAfterDecline({ declineReason: "CARD_DECLINED", declineRetriable: false }, 1),
    ).toEqual({ kind: "STOP", needsNewCard: true });
  });

  it("retries a soft decline with backoff", () => {
    const decision = policy().decideAfterDecline({ declineReason: "CARD_DECLINED" }, 1);
    expect(decision.kind).toBe("RETRY");
    expect(decision.kind === "RETRY" && decision.delayMs).toBeGreaterThan(0);
  });

  it("walks the ladder the host supplied, in order", () => {
    const first = policy().decideAfterDecline({ declineReason: "PROVIDER_ERROR" }, 1);
    const second = policy().decideAfterDecline({ declineReason: "PROVIDER_ERROR" }, 2);
    expect(first).toEqual({ kind: "RETRY", delayMs: 30 * 60_000 });
    expect(second).toEqual({ kind: "RETRY", delayMs: 2 * 60 * 60_000 });
  });

  it("repeats the last rung when the cap outgrows the ladder", () => {
    const longBudget = createChargePolicy({
      maxAttempts: 6,
      backoffMs: [1_000, 2_000],
      stopWithoutNewCard: [],
    });
    expect(longBudget.decideAfterDecline({ declineReason: "PROVIDER_ERROR" }, 5)).toEqual({
      kind: "RETRY",
      delayMs: 2_000,
    });
  });

  it("stops once the budget is spent", () => {
    // Bounded, or a card that soft-declines every time is presented forever.
    expect(policy().decideAfterDecline({ declineReason: "CARD_DECLINED" }, MAX_ATTEMPTS)).toEqual({
      kind: "STOP",
      needsNewCard: false,
    });
  });

  it("treats a decline with no stated reason as soft", () => {
    // Unknown is not terminal. Refusing to retry it would stop collecting from
    // a customer whose card is fine, which is the more expensive way to be wrong.
    expect(policy().decideAfterDecline({}, 1).kind).toBe("RETRY");
  });
});

describe("a charge attempt that threw", () => {
  it("alerts rather than retries an ambiguous outcome", () => {
    // By the time this is raised the gateway has already probed and failed to
    // settle whether money moved. Retrying IS the double charge.
    expect(policy().decideAfterError(new AmbiguousChargeError("stripe", "pay-1", "PROBE_FAILED"), 1))
      .toEqual({ kind: "ALERT" });
  });

  it("alerts on an unrecognized failure too", () => {
    // Anything not positively provable as safe classifies AMBIGUOUS, and the
    // bias is deliberate: a stopped ladder is recoverable, a double bill is not.
    expect(policy().decideAfterError(new Error("who knows"), 1)).toEqual({ kind: "ALERT" });
    expect(policy().decideAfterError(headersTimeout(), 1)).toEqual({ kind: "ALERT" });
  });

  it("retries a failure proven to predate transmission", () => {
    expect(policy().decideAfterError(refusedConnection(), 1).kind).toBe("RETRY");
  });

  it("retries a credential rejection — an operator usually fixes it", () => {
    const error = new ProviderRequestError("stripe", "unauthorized", { httpStatus: 401 });
    expect(policy().decideAfterError(error, 1).kind).toBe("RETRY");
  });

  it("applies the decline policy to a decline that arrived as an exception", () => {
    // Same rule whichever shape it takes — which only works because the walk
    // preserves the adapter's normalized reason instead of flattening it.
    const error = new ChargeDeclinedError("pagbank", "INSUFFICIENT_FUNDS", "no funds");
    expect(policy().decideAfterError(error, 1)).toEqual({ kind: "STOP", needsNewCard: false });
  });

  it("still bounds the retriable failures", () => {
    expect(policy().decideAfterError(refusedConnection(), MAX_ATTEMPTS)).toEqual({
      kind: "STOP",
      needsNewCard: false,
    });
  });
});
