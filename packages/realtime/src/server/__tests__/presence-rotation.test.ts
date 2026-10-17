import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PresenceChange } from "../../core/presence";
import { resetRealtimeRuntime } from "../../core/runtime";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { createApiEvents } from "../create-api-events";
import { PT_BR_EVENTS_MESSAGES } from "../pt-BR";
import { PRESENCE_STREAM_MAX_AGE_MS, __testables } from "../sse";
import type { EventsAuthorization, EventsRouteResult } from "../types";

/**
 * A presence-holding SSE stream is BOUNDED (FUT-437 review, B4): an SSE stream has
 * no client→server half, so a phone that drops off the network would otherwise hold
 * its presence until TCP gave up. At its maximum age the stream asks its client to
 * move (`rotate`), and ends a few seconds later whether or not it did — so a dead
 * peer's presence is released within a minute, and a live client never notices.
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const SEAT_GRANT: EventsAuthorization = {
  subjectId: "p-1",
  topics: ["tenant:t-1:comanda:s-1"],
  presence: ["seat:t-1:s-1:p-1"],
};

async function harness(grant: EventsAuthorization) {
  const heard: PresenceChange[] = [];
  const api = createApiEvents({
    messages: PT_BR_EVENTS_MESSAGES,
    logger: silentLogger,
    driver: createInlineRealtimeDriver({ logger: silentLogger }),
    installSignalHooks: false,
    presence: { onChange: (change) => void heard.push(change), releaseGraceMs: 0 },
    surfaces: [
      {
        name: "seat",
        path: "/seat/:slug/realtime",
        topicsQuery: false,
        domains: [],
        authorize: () => Promise.resolve(grant),
      },
    ],
  });
  await api.start();
  const stream = api.routes.find((route) => route.method === "GET");
  if (!stream) throw new Error("no stream route");
  return { api, heard, open: () => stream.handle({ params: { slug: "loja" }, query: {} }) };
}

/** Everything the stream writes, collected as it arrives; `ended` once it closes. */
function readAll(result: EventsRouteResult): { text: () => string; ended: () => boolean } {
  if (!("response" in result) || !result.response.body) throw new Error("expected a stream");
  const reader = result.response.body.getReader();
  const decoder = new TextDecoder();
  const state = { text: "", ended: false };
  const pump = async (): Promise<void> => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        state.ended = true;
        return;
      }
      state.text += decoder.decode(chunk.value);
    }
  };
  void pump();
  return { text: () => state.text, ended: () => state.ended };
}

async function elapse(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetRealtimeRuntime();
  vi.useRealTimers();
});

describe("a presence-holding SSE stream rotates", () => {
  it("asks its client to move at the max age, then ends and releases a peer that never did", async () => {
    const h = await harness(SEAT_GRANT);
    const wire = readAll(await h.open());
    await elapse(0);
    expect(h.heard).toEqual([{ key: "seat:t-1:s-1:p-1", state: "held" }]);

    await elapse(PRESENCE_STREAM_MAX_AGE_MS);
    expect(wire.text()).toContain('"type":"rotate"');
    expect(wire.ended()).toBe(false);

    await elapse(__testables.ROTATE_GRACE_MS);
    expect(wire.ended()).toBe(true);
    expect(h.heard.at(-1)).toEqual({ key: "seat:t-1:s-1:p-1", state: "released" });
  });

  it("never rotates a stream that holds no presence", async () => {
    const h = await harness({ subjectId: "t-1", topics: ["tenant:t-1:kitchen"] });
    const wire = readAll(await h.open());
    await elapse(PRESENCE_STREAM_MAX_AGE_MS * 3);
    expect(wire.text()).not.toContain('"type":"rotate"');
    expect(wire.ended()).toBe(false);
    h.api.closeAllStreams();
  });
});

describe("a stream never carries a reserved topic", () => {
  it("refuses a grant naming the presence bus, as the ticket does", async () => {
    const h = await harness({ subjectId: "p-1", topics: ["$presence"] });
    expect(await h.open()).toMatchObject({ status: 503 });
    expect(h.heard).toEqual([]);
  });
});
