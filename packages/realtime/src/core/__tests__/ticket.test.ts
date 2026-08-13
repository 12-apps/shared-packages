import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  mintRealtimeTicket,
  TICKET_TTL_SECONDS,
  TicketReplayGuard,
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

/**
 * Single use (12-16). A ticket travels in a query string — the browser's `WebSocket`
 * constructor cannot set headers — so it can land in a proxy log or a shell history.
 * Expiry bounded the damage to one TTL; burning the id on first use removes it.
 */
describe("realtime tickets — every mint is distinguishable", () => {
  it("produces a DIFFERENT ticket for the same topics in the same second", () => {
    // Without a per-mint nonce the payload is a pure function of (topics, expirySecond),
    // so two tabs handshaking in the same second would be byte-identical — and a
    // replay guard would have to refuse the second tab's legitimate connection.
    const first = mintRealtimeTicket(TOPICS, SECRET, NOW);
    const second = mintRealtimeTicket(TOPICS, SECRET, NOW);
    expect(first).not.toBe(second);
    expect(verifyRealtimeTicket(first, SECRET, NOW)?.id).not.toBe(
      verifyRealtimeTicket(second, SECRET, NOW)?.id,
    );
  });

  it("reports the same id every time one ticket is verified", () => {
    const ticket = mintRealtimeTicket(TOPICS, SECRET, NOW);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)?.id).toBe(
      verifyRealtimeTicket(ticket, SECRET, NOW)?.id,
    );
  });

  it("falls back to the signature as the id for a legacy nonce-less ticket", () => {
    // A ticket minted by an older publisher of this package carries no `n`. Its
    // signature is exactly as unique as its payload was, so single-use enforcement is
    // coarser for it, never absent.
    const body = Buffer.from(
      JSON.stringify({ t: TOPICS, e: NOW + TICKET_TTL_SECONDS }),
    ).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(body).digest("base64url");
    const verified = verifyRealtimeTicket(`${body}.${signature}`, SECRET, NOW);
    expect(verified?.id).toBe(signature);
  });
});

describe("TicketReplayGuard", () => {
  it("admits a ticket once and refuses every replay of it", () => {
    const guard = new TicketReplayGuard();
    const ticket = verifyRealtimeTicket(mintRealtimeTicket(TOPICS, SECRET, NOW), SECRET, NOW);
    if (!ticket) throw new Error("expected a valid ticket");
    expect(guard.consume(ticket, NOW)).toBe(true);
    expect(guard.consume(ticket, NOW)).toBe(false);
    expect(guard.consume(ticket, NOW + 1)).toBe(false);
  });

  it("admits two DIFFERENT tickets for the same topics — two tabs are not a replay", () => {
    const guard = new TicketReplayGuard();
    const mint = (): NonNullable<ReturnType<typeof verifyRealtimeTicket>> => {
      const ticket = verifyRealtimeTicket(mintRealtimeTicket(TOPICS, SECRET, NOW), SECRET, NOW);
      if (!ticket) throw new Error("expected a valid ticket");
      return ticket;
    };
    expect(guard.consume(mint(), NOW)).toBe(true);
    expect(guard.consume(mint(), NOW)).toBe(true);
  });

  it("forgets an id once the ticket it names could no longer be verified", () => {
    // Bounded by construction: the set never holds more than one TTL's worth of
    // handshakes, so it cannot grow without limit.
    const guard = new TicketReplayGuard();
    const ticket = verifyRealtimeTicket(mintRealtimeTicket(TOPICS, SECRET, NOW), SECRET, NOW);
    if (!ticket) throw new Error("expected a valid ticket");
    guard.consume(ticket, NOW);
    expect(guard.size).toBe(1);

    // A later handshake sweeps first, and the expired id goes — so the set holds only
    // the live one. The next handshake is what triggers the sweep, deliberately: a
    // timer would keep this object alive in a process that had stopped using it.
    const later = NOW + TICKET_TTL_SECONDS + 1;
    const fresh = verifyRealtimeTicket(mintRealtimeTicket(TOPICS, SECRET, later), SECRET, later);
    if (!fresh) throw new Error("expected a valid ticket");
    expect(guard.consume(fresh, later)).toBe(true);
    expect(guard.size).toBe(1);
  });

  it("sweeps at most once per second, so a burst of handshakes is cheap", () => {
    const guard = new TicketReplayGuard();
    const tickets = Array.from({ length: 5 }, () => {
      const ticket = verifyRealtimeTicket(mintRealtimeTicket(TOPICS, SECRET, NOW), SECRET, NOW);
      if (!ticket) throw new Error("expected a valid ticket");
      return ticket;
    });
    for (const ticket of tickets) expect(guard.consume(ticket, NOW)).toBe(true);
    expect(guard.size).toBe(5);
  });
});
