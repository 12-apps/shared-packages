import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  mintRealtimeTicket,
  TICKET_TTL_SECONDS,
  verifyRealtimeTicket,
} from "../ticket";

/**
 * The ticket is the ONLY thing standing between the WebSocket gateway and a
 * subscription it was never authorized for, so the refusals matter more than
 * the happy path. Every test pins a way a forged or stale ticket must fail.
 */

const SECRET = "test-secret-value";
const TOPICS = ["tenant:abc:kitchen", "tenant:abc:kitchen:station-1"];
const NOW = 1_800_000_000;

describe("realtime tickets", () => {
  it("round-trips the authorized topics", () => {
    const ticket = mintRealtimeTicket(TOPICS, SECRET, NOW);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)?.topics).toEqual(TOPICS);
  });

  it("expires after the TTL", () => {
    const ticket = mintRealtimeTicket(TOPICS, SECRET, NOW);
    // Still good one second before, gone at the boundary — a ticket whose
    // expiry equals now has no time left to be used.
    expect(verifyRealtimeTicket(ticket, SECRET, NOW + TICKET_TTL_SECONDS - 1)).not.toBeNull();
    expect(verifyRealtimeTicket(ticket, SECRET, NOW + TICKET_TTL_SECONDS)).toBeNull();
  });

  it("refuses a ticket signed with another secret", () => {
    const ticket = mintRealtimeTicket(TOPICS, SECRET, NOW);
    expect(verifyRealtimeTicket(ticket, "a-different-secret", NOW)).toBeNull();
  });

  it("refuses a tampered topic list", () => {
    const ticket = mintRealtimeTicket(["tenant:abc:kitchen"], SECRET, NOW);
    const [, signature] = ticket.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ t: ["tenant:victim:kitchen"], e: NOW + 30 }),
    ).toString("base64url");
    expect(verifyRealtimeTicket(`${forgedBody}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("refuses malformed input rather than throwing", () => {
    for (const bad of ["", ".", "nodot", "a.", ".b", "!!!.???"]) {
      expect(verifyRealtimeTicket(bad, SECRET, NOW)).toBeNull();
    }
  });

  it("refuses a ticket carrying a malformed topic name", () => {
    // A signature alone must not be enough to reach the driver's channel names.
    const body = Buffer.from(
      JSON.stringify({ t: ["not a valid topic"], e: NOW + 30 }),
    ).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyRealtimeTicket(`${body}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("refuses an empty or oversized topic list at mint time", () => {
    expect(() => mintRealtimeTicket([], SECRET, NOW)).toThrow();
    const tooMany = Array.from({ length: 17 }, (_, i) => `tenant:abc:kitchen:s${i}`);
    expect(() => mintRealtimeTicket(tooMany, SECRET, NOW)).toThrow();
  });

  it("refuses to mint or verify without a secret", () => {
    expect(() => mintRealtimeTicket(TOPICS, "", NOW)).toThrow();
    expect(verifyRealtimeTicket(mintRealtimeTicket(TOPICS, SECRET, NOW), "", NOW)).toBeNull();
  });
});
