import { describe, expect, it } from "vitest";

import { AccessTokenError, signAccessToken, verifyAccessToken } from "../access-token";
import { signingKeyProvider } from "../keys";
import { testSigningKey } from "./fixtures";

/**
 * Access-token verification, and specifically WHY it failed.
 *
 * The happy path is exercised all over `token.test.ts`; what is pinned here is
 * the discrimination, because it is the whole reason a connected assistant can
 * say "reconnect" instead of reporting an opaque failure on every tool call.
 *
 * Two rules pull against each other and both are asserted:
 *
 *   - expiry is NAMED, because a client is meant to act on it by refreshing;
 *   - everything cryptographic is NOT, because a message identifying the claim
 *     that failed is an oracle for the next attempt.
 */

const ORIGIN = "https://app.example.com";
const OTHER_ORIGIN = "https://evil.example.com";

/** A fixed clock, so "expired" is a fact about the token and not about the run. */
const FIXED_NOW = Date.parse("2026-09-10T12:00:00.000Z");

const MINT = {
  email: "owner@example.com",
  subject: "google-sub-1",
  scopes: ["mcp:read", "mcp:write"],
  origin: ORIGIN,
} as const;

/** Verify and hand back the thrown {@link AccessTokenError}, failing if none is. */
async function reasonOf(
  ...args: Parameters<typeof verifyAccessToken>
): Promise<AccessTokenError> {
  try {
    await verifyAccessToken(...args);
  } catch (error) {
    if (error instanceof AccessTokenError) return error;
    throw error;
  }
  throw new Error("expected verification to fail, but it succeeded");
}

describe("verifyAccessToken failure reasons", () => {
  it("verifies a fresh token and returns the bound identity", async () => {
    const key = await testSigningKey();
    const token = await signAccessToken(key, MINT);

    await expect(verifyAccessToken(key, token ?? "", { origin: ORIGIN })).resolves.toEqual({
      email: MINT.email,
      subject: MINT.subject,
      scopes: [...MINT.scopes],
    });
  });

  it("names EXPIRY, because a client is supposed to refresh and retry", async () => {
    const key = await testSigningKey();
    const token = await signAccessToken(key, { ...MINT, ttlSeconds: 60 }, { now: FIXED_NOW });

    // Well past the TTL and the clock tolerance.
    const error = await reasonOf(key, token ?? "", {
      origin: ORIGIN,
      now: FIXED_NOW + 3_600_000,
    });

    expect(error.reason).toBe("expired");
    // Still `invalid_token` on the wire: the RFC has no separate code for it, and
    // the detail rides in the reason rather than inventing a challenge.
    expect(error.code).toBe("invalid_token");
  });

  it("does NOT name a wrong audience — that would be an oracle", async () => {
    const key = await testSigningKey();
    // Minted for another deployment: the single most likely real cause after
    // expiry, and the one a user fixes by reconnecting.
    const token = await signAccessToken(key, { ...MINT, origin: OTHER_ORIGIN });

    const error = await reasonOf(key, token ?? "", { origin: ORIGIN });

    expect(error.reason).toBe("unverified");
  });

  it("does not name a wrong SIGNING KEY either", async () => {
    const minted = await signAccessToken(await testSigningKey(), MINT);
    // A different key pair entirely — a rotated-away kid, or a forgery.
    const other = await testSigningKey();

    expect((await reasonOf(other, minted ?? "", { origin: ORIGIN })).reason).toBe("unverified");
  });

  it("does not name a malformed token", async () => {
    const key = await testSigningKey();

    expect((await reasonOf(key, "not-a-jwt", { origin: ORIGIN })).reason).toBe("unverified");
  });

  it("reports an unprovisioned signing key as the operator problem it is", async () => {
    // Distinct from `unverified` on purpose: no token will ever work here, so a
    // client that keeps re-running OAuth is looping for nothing.
    const absent = signingKeyProvider(() => ({ pem: undefined, kid: undefined }));

    const error = await reasonOf(absent, "any-token", { origin: ORIGIN });

    expect(error.reason).toBe("not_provisioned");
  });

  it("separates a scope shortfall from a broken token", async () => {
    const key = await testSigningKey();
    const token = await signAccessToken(key, { ...MINT, scopes: ["mcp:read"] });

    const error = await reasonOf(key, token ?? "", {
      origin: ORIGIN,
      requiredScope: "mcp:write",
    });

    expect(error.reason).toBe("insufficient_scope");
    expect(error.code).toBe("insufficient_scope");
  });
});
