import { describe, expect, it } from "vitest";

import {
  InvalidTopicError,
  isValidTopic,
  parseTenantTopic,
  parseUserTopic,
  tenantTopic,
  userTopic,
} from "../topics";

describe("tenantTopic", () => {
  it("builds the canonical tenant:<id>:<domain> form", () => {
    expect(tenantTopic("c1", "kitchen")).toBe("tenant:c1:kitchen");
  });

  it("appends qualifier segments", () => {
    expect(tenantTopic("c1", "tables", "mesa-12")).toBe("tenant:c1:tables:mesa-12");
  });

  it("rejects a segment carrying the separator — no tenant smuggling", () => {
    expect(() => tenantTopic("c1:c2", "kitchen")).toThrow(InvalidTopicError);
    expect(() => tenantTopic("c1", "kitchen:other")).toThrow(InvalidTopicError);
  });

  it("rejects empty and whitespace segments", () => {
    expect(() => tenantTopic("", "kitchen")).toThrow(InvalidTopicError);
    expect(() => tenantTopic("c1", "a b")).toThrow(InvalidTopicError);
  });
});

describe("parseTenantTopic", () => {
  it("round-trips what tenantTopic builds", () => {
    expect(parseTenantTopic(tenantTopic("c1", "orders", "o9"))).toEqual({
      tenantId: "c1",
      domain: "orders",
      qualifiers: ["o9"],
    });
  });

  it("returns null for non-tenant and malformed topics", () => {
    expect(parseTenantTopic("system:health")).toBeNull();
    expect(parseTenantTopic("tenant:c1")).toBeNull();
    expect(parseTenantTopic("tenant::kitchen")).toBeNull();
  });
});

describe("isValidTopic", () => {
  it("accepts well-formed topics of any scheme", () => {
    expect(isValidTopic("tenant:c1:kitchen")).toBe(true);
    expect(isValidTopic("system:health")).toBe(true);
  });

  it("rejects empty segments", () => {
    expect(isValidTopic("")).toBe(false);
    expect(isValidTopic("tenant::kitchen")).toBe(false);
    expect(isValidTopic("tenant:c1:")).toBe(false);
  });

  it("rejects GLOB metacharacters, which a client-supplied qualifier could carry", () => {
    // Inert while every driver subscribes by exact match; a cross-tenant wildcard the day
    // one reaches for `PSUBSCRIBE`. A qualifier is the ONE part of a resolved topic that
    // comes from the client, so this is where it is cheapest to make impossible.
    expect(isValidTopic("tenant:c1:kitchen:*")).toBe(false);
    expect(isValidTopic("tenant:c1:kitchen:st?")).toBe(false);
    expect(isValidTopic("tenant:c1:kitchen:[ab]")).toBe(false);
    expect(isValidTopic("tenant:c1:kitchen:a\\b")).toBe(false);
    // And still accepts everything a real qualifier is.
    expect(isValidTopic("tenant:ckv9v2x0000008l3g1h2i3j4:kitchen:st-01_A")).toBe(true);
  });
});

/**
 * User-scoped topics exist because tenant ones cannot reach a shopper: a buyer
 * belongs to no tenant, so anything addressed to a PERSON — their
 * notifications, or being told their terms acceptance went stale (FUT-462) —
 * had no channel at all.
 */
describe("userTopic", () => {
  it("puts the subject id first, so the host authorizes from the name alone", () => {
    expect(userTopic("u1", "notifications")).toBe("user:u1:notifications");
  });

  it("appends qualifiers after the domain", () => {
    expect(userTopic("u1", "orders", "ord_9")).toBe("user:u1:orders:ord_9");
  });

  /**
   * The isolation guarantee. A qualifier carrying a separator could otherwise
   * read as another user's topic once joined, so a malformed segment is
   * refused at construction rather than parsed leniently later.
   */
  it("refuses a segment that could forge another subject", () => {
    expect(() => userTopic("u1", "orders", "x:user:u2:orders")).toThrow(InvalidTopicError);
    expect(() => userTopic("", "notifications")).toThrow(InvalidTopicError);
  });
});

describe("parseUserTopic", () => {
  it("returns the subject id for the host to compare against the session", () => {
    expect(parseUserTopic("user:u1:notifications")).toEqual({
      userId: "u1",
      domain: "notifications",
      qualifiers: [],
    });
  });

  it("does not confuse the two schemes", () => {
    expect(parseUserTopic("tenant:c1:kitchen")).toBeNull();
    expect(parseTenantTopic("user:u1:notifications")).toBeNull();
  });

  it("returns null for malformed topics", () => {
    expect(parseUserTopic("user:u1")).toBeNull();
    expect(parseUserTopic("user::notifications")).toBeNull();
  });
});
