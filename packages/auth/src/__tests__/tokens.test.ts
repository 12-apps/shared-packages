import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOKEN_TTL_MS,
  buildTokenLink,
  hashToken,
  isTokenExpired,
  issueToken,
  tokenHashesMatch,
} from "../tokens";

describe("issueToken", () => {
  it("returns the raw token and its hash, which is what gets stored", () => {
    const issued = issueToken();
    expect(issued.token).toBeTruthy();
    expect(issued.tokenHash).toBe(hashToken(issued.token));
    // The hash must not be derivable back — the point of storing it — so at the
    // very least it is never the raw value.
    expect(issued.tokenHash).not.toBe(issued.token);
  });

  it("mints a fresh token every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => issueToken().token));
    expect(seen.size).toBe(50);
  });

  it("is URL-safe, so a mail client cannot mangle the link", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(issueToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("expires a TTL after the given now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(issueToken({ now }).expiresAt.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(DEFAULT_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
    expect(issueToken({ now, ttlMs: 5_000 }).expiresAt.toISOString()).toBe(
      "2026-01-01T00:00:05.000Z",
    );
  });
});

describe("hashToken", () => {
  it("is stable, so the same link always finds the same row", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates tokens that differ by one character", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("tokenHashesMatch", () => {
  it("compares equal and unequal hashes", () => {
    expect(tokenHashesMatch(hashToken("a"), hashToken("a"))).toBe(true);
    expect(tokenHashesMatch(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("is false for different lengths rather than throwing", () => {
    expect(tokenHashesMatch("abc", "abcd")).toBe(false);
  });
});

describe("isTokenExpired", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");

  it("is false strictly before the expiry", () => {
    expect(isTokenExpired(new Date("2026-01-01T12:00:01.000Z"), now)).toBe(false);
  });

  it("is true at and after the expiry", () => {
    expect(isTokenExpired(new Date("2026-01-01T12:00:00.000Z"), now)).toBe(true);
    expect(isTokenExpired(new Date("2026-01-01T11:59:59.000Z"), now)).toBe(true);
  });

  it("accepts an ISO string, as a database row hands one back", () => {
    expect(isTokenExpired("2026-01-01T12:00:01.000Z", now)).toBe(false);
    expect(isTokenExpired("2026-01-01T11:00:00.000Z", now)).toBe(true);
  });

  it("treats a missing or unparseable expiry as expired — fail closed", () => {
    expect(isTokenExpired(null, now)).toBe(true);
    expect(isTokenExpired(undefined, now)).toBe(true);
    expect(isTokenExpired("not a date", now)).toBe(true);
  });
});

describe("buildTokenLink", () => {
  it("puts the token on the query string of an absolute URL", () => {
    expect(buildTokenLink("https://app.example.com", "/reset-password", "tok3n")).toBe(
      "https://app.example.com/reset-password?token=tok3n",
    );
  });

  it("keeps a base path on the origin", () => {
    expect(buildTokenLink("https://app.example.com/br/", "verify", "t")).toBe(
      "https://app.example.com/br/verify?token=t",
    );
  });

  it("encodes a token that would otherwise break the query string", () => {
    const link = buildTokenLink("https://app.example.com", "/verify-email", "a b&c=d");
    expect(new URL(link).searchParams.get("token")).toBe("a b&c=d");
  });
});
