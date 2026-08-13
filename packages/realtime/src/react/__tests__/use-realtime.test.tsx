// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRealtime } from "../use-realtime";
import type { RealtimeMessage, WireSource } from "../types";

/**
 * `useRealtime` — the standalone channel, for a component with no provider above it.
 *
 * Most of what this hook does is proven where it is USED: `web-events.test.tsx` mounts the
 * provider for real and covers the null endpoint, the status a screen keys its poll off and
 * the two polling seams. What that leaves is the pair of claims about the hook's own
 * LIFECYCLE, which no consumer-level test can see:
 *
 *   1. an `onMessage` written inline — the ordinary way to write one — must not reconnect the
 *      channel on every render, and must not strand it on the first closure either;
 *   2. an unmount must close the channel, or a navigation leaks a live connection whose
 *      handlers still point at torn-down state.
 *
 * Both fail SILENTLY in a browser. A stale closure keeps delivering to the previous render's
 * scope, so the stream is up and the screen simply never moves.
 */

/** A scriptable wire source, and every one the hook has built. */
function fakeWire() {
  const built: FakeSource[] = [];

  class FakeSource implements WireSource {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    closeCalls = 0;

    constructor(readonly url: string) {}

    close(): void {
      this.closeCalls += 1;
    }
  }

  return {
    built,
    /**
     * ONE stable reference: `createSource` is an effect dependency, so a factory rebuilt per
     * render would reconnect on every render and hide the very thing case 1 is about.
     */
    factory: (url: string): WireSource => {
      const source = new FakeSource(url);
      built.push(source);
      return source;
    },
    only: (): FakeSource => {
      const source = built[0];
      if (!source) throw new Error("no source was built");
      return source;
    },
  };
}

const NOW_MS = 1_767_225_600_000;
const ENDPOINT = "/api/admin/loja-a/realtime?topics=kitchen";

/** The wire firing, not the user — so it belongs inside `act`. */
function goLive(source: WireSource): void {
  act(() => {
    source.onopen?.({});
  });
}
function deliverHint(source: WireSource, message: RealtimeMessage): void {
  act(() => {
    source.onmessage?.({ data: JSON.stringify(message) });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRealtime", () => {
  it("dispatches events to the LATEST onMessage callback", () => {
    const wire = fakeWire();
    const received: { types: string[] } = { types: [] };

    const { rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        useRealtime({
          url: ENDPOINT,
          createSource: wire.factory,
          // Written inline, as the docstring invites: "reads the latest callback each event;
          // no need to memoize."
          onMessage: (message) => {
            received.types.push(`${tag}:${message.type}`);
          },
        }),
      { initialProps: { tag: "first" } },
    );
    goLive(wire.only());
    rerender({ tag: "second" });

    deliverHint(wire.only(), {
      topic: "tenant:t-1:kitchen",
      type: "changed",
      data: {},
      ts: NOW_MS,
      id: "e-1",
    });

    // The two halves of the same guarantee. A callback in the effect's deps would have
    // rebuilt the channel here — a fresh handshake per render, on a subscription that never
    // changed. Reading it through a ref instead is only correct if the ref is CURRENT: the
    // first render's closure still exists, and delivering to it is a screen whose stream is
    // up and whose data never moves.
    expect(wire.built).toHaveLength(1);
    expect(received.types).toEqual(["second:changed"]);
  });

  it("closes the channel on unmount", () => {
    const wire = fakeWire();

    const { unmount } = renderHook(() => useRealtime({ url: ENDPOINT, createSource: wire.factory }));
    goLive(wire.only());

    unmount();

    // The connection outlives the component otherwise: a subscription nothing will ever
    // release, still calling `setStatus` on a torn-down tree, and one more per navigation.
    expect(wire.only().closeCalls).toBe(1);
  });
});
