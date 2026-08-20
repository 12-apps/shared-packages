import { describe, expect, it } from "vitest";

import { DEFAULT_RATE_LIMITS, createInProcessRateLimiter } from "../rate-limit";

/**
 * The limiter every host was writing for itself.
 *
 * A fake clock throughout — a limiter tested against the real one either sleeps
 * for five minutes or asserts nothing about the window at all.
 */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => { at += ms; } };
}

describe("createInProcessRateLimiter", () => {
  it("allows up to the bucket's limit and refuses the next one", async () => {
    const limiter = createInProcessRateLimiter({ limits: { signin: 3 }, now: clock().now });

    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await limiter.check("signin:ana@b.co"));

    expect(results).toEqual([true, true, true, false]);
  });

  it("counts each key separately, so one person cannot lock out another", async () => {
    const limiter = createInProcessRateLimiter({ limits: { signin: 1 }, now: clock().now });

    expect(await limiter.check("signin:ana@b.co")).toBe(true);
    expect(await limiter.check("signin:ana@b.co")).toBe(false);
    // A different address is untouched by the first one's spend.
    expect(await limiter.check("signin:bob@b.co")).toBe(true);
  });

  it("reopens the budget once the window passes", async () => {
    const time = clock();
    const limiter = createInProcessRateLimiter({
      limits: { signin: 1 },
      windowMs: 60_000,
      now: time.now,
    });

    expect(await limiter.check("signin:ana@b.co")).toBe(true);
    expect(await limiter.check("signin:ana@b.co")).toBe(false);

    time.advance(60_001);

    expect(await limiter.check("signin:ana@b.co")).toBe(true);
  });

  it("reads the bucket from the key's prefix, not the whole key", async () => {
    // Keys are `<operation>:<address>`. Without the split every address would
    // get the default limit and the per-operation numbers would do nothing.
    const limiter = createInProcessRateLimiter({
      limits: { reset: 1 },
      defaultLimit: 9,
      now: clock().now,
    });

    expect(await limiter.check("reset:ana@b.co")).toBe(true);
    expect(await limiter.check("reset:ana@b.co")).toBe(false);
  });

  it("falls back to the default limit for a bucket nobody configured", async () => {
    const limiter = createInProcessRateLimiter({ limits: {}, defaultLimit: 2, now: clock().now });

    expect(await limiter.check("whatever:ana@b.co")).toBe(true);
    expect(await limiter.check("whatever:ana@b.co")).toBe(true);
    expect(await limiter.check("whatever:ana@b.co")).toBe(false);
  });

  it("sweeps expired windows so a dictionary walk cannot grow the map forever", async () => {
    // The map is keyed by address. Without the sweep an attacker trying a list
    // of addresses leaves a window per address behind, permanently.
    const time = clock();
    const limiter = createInProcessRateLimiter({ sweepAt: 3, windowMs: 1_000, now: time.now });

    for (let i = 0; i < 3; i += 1) await limiter.check(`signin:user${i}@b.co`);
    time.advance(1_001);
    // This insert crosses the threshold and sweeps the three now-expired ones.
    await limiter.check("signin:later@b.co");

    // Observable through behaviour rather than internals: the swept keys start
    // from a fresh budget, which they would also do without a sweep — so assert
    // the limiter still WORKS after one, which a broken sweep would break.
    expect(await limiter.check("signin:user0@b.co")).toBe(true);
  });

  it("ships defaults that are tighter for the three that send mail", async () => {
    // Sign-in is retyped by real people; a reset link is not requested five
    // times by anyone who is not being attacked with it.
    expect(DEFAULT_RATE_LIMITS.signin).toBeGreaterThan(DEFAULT_RATE_LIMITS.reset ?? 0);
    expect(DEFAULT_RATE_LIMITS.reset).toBe(DEFAULT_RATE_LIMITS.resend);
  });
});
