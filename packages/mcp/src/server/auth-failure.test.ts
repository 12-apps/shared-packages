import { describe, expect, it } from "vitest";

import {
  authFailureData,
  describeAuthFailure,
  type McpAuthFailureReason,
} from "./auth-failure";

/**
 * The refusal vocabulary.
 *
 * `jsonrpc.test.ts` proves the transport carries this; these cases pin the table
 * itself, because its value is entirely in the distinctions it makes — a reason
 * that resolved to the same challenge, action and wording as every other one
 * would compile, pass a smoke test, and leave the agent exactly as unable to say
 * anything useful as before.
 */

/**
 * A FUNCTION rather than a shared array: every caller gets its own copy, so no
 * case can mutate what another case iterates.
 */
const everyReason = (): McpAuthFailureReason[] => [
  "no_token",
  "expired",
  "unverified",
  "incomplete",
  "not_provisioned",
  "surface_disabled",
  "insufficient_scope",
];

describe("describeAuthFailure", () => {
  it.each(everyReason())("gives %s a challenge code the RFC defines", (reason) => {
    // A host puts this straight into `WWW-Authenticate`, where anything outside
    // these two is not a challenge a client's OAuth machinery will act on.
    expect(["invalid_token", "insufficient_scope"]).toContain(
      describeAuthFailure(reason).challenge,
    );
  });

  it.each(everyReason())("gives %s a message worth relaying to a person", (reason) => {
    const { message } = describeAuthFailure(reason);

    // Long enough to be a sentence rather than a label, and ending like one.
    expect(message.length).toBeGreaterThan(40);
    expect(message.trimEnd().endsWith(".")).toBe(true);
  });

  it("says something DIFFERENT for every reason", () => {
    // The whole point of the table. Two reasons sharing wording is the bug it
    // exists to prevent, and it is invisible in any single-reason assertion.
    const reasons = everyReason();
    const messages = reasons.map((reason) => describeAuthFailure(reason).message);

    expect(new Set(messages).size).toBe(reasons.length);
  });

  it("echoes the reason it was asked about", () => {
    expect(describeAuthFailure("expired").reason).toBe("expired");
  });

  it("routes a scope shortfall to the scope challenge, not the token one", () => {
    // These are the two the RFC separates, and conflating them would make a
    // missing scope look like a broken token — sending the client to re-auth
    // rather than to ask for the wider grant.
    expect(describeAuthFailure("insufficient_scope").challenge).toBe("insufficient_scope");
    expect(describeAuthFailure("expired").challenge).toBe("invalid_token");
  });
});

describe("authFailureData", () => {
  it("calls a lapsed token recoverable and a dead deployment not", () => {
    // `recoverable` is what stops a client looping through the consent screen for
    // a problem no consent screen can fix.
    expect(authFailureData(describeAuthFailure("expired"))).toEqual({
      reason: "expired",
      action: "refresh",
      recoverable: true,
    });
    expect(authFailureData(describeAuthFailure("not_provisioned"))).toEqual({
      reason: "not_provisioned",
      action: "contact_operator",
      recoverable: false,
    });
  });

  it.each(everyReason())("derives recoverability from the action for %s", (reason) => {
    const failure = describeAuthFailure(reason);

    expect(authFailureData(failure).recoverable).toBe(failure.action !== "contact_operator");
  });
});
