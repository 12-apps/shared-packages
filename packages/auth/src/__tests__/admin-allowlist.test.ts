import { afterEach, describe, expect, it, vi } from "vitest";

import { isAdminEmail, parseAdminEmails } from "../admin";

describe("parseAdminEmails", () => {
  it("returns an empty list for undefined/null/empty input", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails(null)).toEqual([]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails("   ")).toEqual([]);
  });

  it("splits, trims, and lower-cases entries", () => {
    expect(parseAdminEmails(" Admin@Example.com , Owner@Example.COM ")).toEqual([
      "admin@example.com",
      "owner@example.com",
    ]);
  });

  it("drops empty segments from stray/trailing commas", () => {
    expect(parseAdminEmails("a@x.com,,b@x.com,")).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });
});

describe("isAdminEmail", () => {
  const allowlist = "admin@example.com, owner@example.com";

  it("grants access to an allowlisted email (case-insensitive, trimmed)", () => {
    expect(isAdminEmail("admin@example.com", allowlist)).toBe(true);
    expect(isAdminEmail("ADMIN@example.com", allowlist)).toBe(true);
    expect(isAdminEmail("  owner@example.com  ", allowlist)).toBe(true);
  });

  it("denies a non-allowlisted email", () => {
    expect(isAdminEmail("stranger@example.com", allowlist)).toBe(false);
  });

  it("denies when the allowlist is empty or unset", () => {
    expect(isAdminEmail("admin@example.com", "")).toBe(false);
    expect(isAdminEmail("admin@example.com", undefined)).toBe(false);
  });

  it("denies when the email is missing", () => {
    expect(isAdminEmail(undefined, allowlist)).toBe(false);
    expect(isAdminEmail(null, allowlist)).toBe(false);
    expect(isAdminEmail("", allowlist)).toBe(false);
  });

  describe("with the ADMIN_EMAILS environment variable", () => {
    // vi.stubEnv rather than assigning to process.env: it records the previous
    // value itself, so a failing assertion cannot leave the variable set for
    // whatever runs next in the same worker.
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("falls back to process.env.ADMIN_EMAILS when no allowlist is passed", () => {
      vi.stubEnv("ADMIN_EMAILS", "env-admin@example.com");
      expect(isAdminEmail("env-admin@example.com")).toBe(true);
      expect(isAdminEmail("someone-else@example.com")).toBe(false);
    });

    it("denies everyone when process.env.ADMIN_EMAILS is unset", () => {
      vi.stubEnv("ADMIN_EMAILS", undefined);
      expect(isAdminEmail("admin@example.com")).toBe(false);
    });
  });
});
