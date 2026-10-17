import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInlineRealtimeDriver } from "../../drivers/inline";
import { PRESENCE_TOPIC } from "../presence";
import { PRESENCE_RELEASE_GRACE_MS, subscribePresence } from "../presence-listener";
import { configureRealtime, publishRealtimeEvent, resetRealtimeRuntime } from "../runtime";

/**
 * The listener's merged view: a key is released only when NO holder has it any
 * more, and only after a short grace in which nobody took it back — so a page
 * navigation, a deploy or an SSE rotation onto another process never reads as
 * "left, then arrived" (FUT-437 review, B3/B4).
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
const RENEW_MS = 10_000;
/** A frozen start instant: the flakiness gate forbids `Date.now()` in a test body. */
const START_MS = 1_767_225_600_000;

async function settle(): Promise<void> {
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

/** A started listener with its own clock and its own record of what it heard. */
async function listen(releaseGraceMs?: number) {
  const clock = { ms: START_MS };
  const heard: string[] = [];
  const stop = await subscribePresence(
    (change) => {
      heard.push(`${change.key}:${change.state}`);
    },
    silentLogger,
    {
      renewMs: RENEW_MS,
      now: () => clock.ms,
      ...(releaseGraceMs === undefined ? {} : { releaseGraceMs }),
    },
  );
  return {
    heard,
    stop: async (): Promise<void> => {
      await stop();
      await settle();
    },
    /** Announce what one holder process would; `null` is a holder too old to name itself. */
    announce: async (holder: string | null, state: "held" | "released", key: string) => {
      const data = holder === null ? { keys: [key] } : { keys: [key], holder };
      await publishRealtimeEvent(PRESENCE_TOPIC, { type: `presence.${state}`, data });
      await settle();
    },
    /** Move both clocks on: the timers and the listener's own. */
    elapse: async (ms: number) => {
      clock.ms += ms;
      await vi.advanceTimersByTimeAsync(ms);
      await settle();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  configureRealtime({ driver: createInlineRealtimeDriver({ logger: silentLogger }), logger: silentLogger });
});

afterEach(() => {
  resetRealtimeRuntime();
  vi.useRealTimers();
});

describe("subscribePresence — a release waits out its grace", () => {
  it("reports a release once the grace passes with nobody taking the key back", async () => {
    const h = await listen();
    await h.announce("gw-1", "held", "seat:k");
    await h.announce("gw-1", "released", "seat:k");
    expect(h.heard).toEqual(["seat:k:held"]);

    await h.elapse(PRESENCE_RELEASE_GRACE_MS);
    expect(h.heard).toEqual(["seat:k:held", "seat:k:released"]);
    await h.stop();
  });

  it("never reports a release when the key is held again inside the grace — a navigation", async () => {
    const h = await listen();
    await h.announce("gw-1", "held", "seat:k");
    await h.announce("gw-1", "released", "seat:k");
    await h.elapse(1_000);
    await h.announce("gw-1", "held", "seat:k");
    await h.elapse(PRESENCE_RELEASE_GRACE_MS * 2);
    expect(h.heard).toEqual(["seat:k:held", "seat:k:held"]);
    await h.stop();
  });

  it("cancels the release when the re-hold lands in ANOTHER process — a rotation or a deploy", async () => {
    const h = await listen();
    await h.announce("api-1", "held", "seat:k");
    await h.announce("api-1", "released", "seat:k");
    await h.announce("api-2", "held", "seat:k");
    await h.elapse(PRESENCE_RELEASE_GRACE_MS * 2);
    expect(h.heard.filter((line) => line.endsWith("released"))).toEqual([]);
    await h.stop();
  });

  it("reports a pending release at once when the listener stops, rather than losing it", async () => {
    const h = await listen();
    await h.announce("gw-1", "held", "seat:k");
    await h.announce("gw-1", "released", "seat:k");
    await h.stop();
    expect(h.heard).toEqual(["seat:k:held", "seat:k:released"]);
  });
});

describe("subscribePresence — merged across holders", () => {
  it("keeps a key held while another process still holds it", async () => {
    const h = await listen(0);
    await h.announce("gw-1", "held", "seat:k");
    await h.announce("api-1", "held", "seat:k");
    await h.announce("gw-1", "released", "seat:k");
    expect(h.heard.filter((line) => line.endsWith("released"))).toEqual([]);

    await h.announce("api-1", "released", "seat:k");
    expect(h.heard.at(-1)).toBe("seat:k:released");
    await h.stop();
  });

  it("stops counting a holder that has gone silent past its lease", async () => {
    const h = await listen(0);
    await h.announce("crashed", "held", "seat:k");
    await h.announce("gw-1", "held", "seat:k");
    // The crashed holder never renews; the live one does, then lets go.
    await h.elapse(RENEW_MS * 3);
    await h.announce("gw-1", "held", "seat:k");
    await h.announce("gw-1", "released", "seat:k");
    expect(h.heard.at(-1)).toBe("seat:k:released");
    await h.stop();
  });

  it("reports the release of a key it never saw held — it may predate this process", async () => {
    const h = await listen(0);
    await h.announce("gw-1", "released", "seat:k");
    expect(h.heard).toEqual(["seat:k:released"]);
    await h.stop();
  });

  it("treats a holder too old to name itself as one holder", async () => {
    const h = await listen(0);
    await h.announce(null, "held", "seat:k");
    await h.announce(null, "released", "seat:k");
    expect(h.heard).toEqual(["seat:k:held", "seat:k:released"]);
    await h.stop();
  });
});
