import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeChannel } from "../connection";
import { CONTROL_TOPIC } from "../liveness";
import { ROTATE_TYPE } from "../rotation";
import type { RealtimeMessage, RealtimeStatus, WireSource } from "../types";

/**
 * A planned SSE rotation is invisible to consumers (FUT-437 review, B4): the server
 * bounds a presence-holding stream's age, and the client answers by opening its next
 * stream BEFORE it lets the old one go — so the status never leaves `connected`,
 * nothing re-reads, and no event published in between is lost.
 */

class FakeSource implements WireSource {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }
}

function harness() {
  const built: FakeSource[] = [];
  const statuses: RealtimeStatus[] = [];
  const messages: RealtimeMessage[] = [];
  const channel = new RealtimeChannel({
    url: "/seat/realtime",
    wire: "sse",
    createSource: () => {
      const source = new FakeSource();
      built.push(source);
      return source;
    },
    onStatusChange: (status) => statuses.push(status),
    onMessage: (message) => messages.push(message),
  });
  const source = (index: number): FakeSource => {
    const found = built[index];
    if (!found) throw new Error(`no source ${index}`);
    return found;
  };
  return { channel, built, statuses, messages, source };
}

function frame(source: WireSource, message: RealtimeMessage): void {
  source.onmessage?.({ data: JSON.stringify(message) });
}

const ROTATE: RealtimeMessage = { topic: CONTROL_TOPIC, type: ROTATE_TYPE, data: {}, ts: 1, id: "rot-1" };
const HINT: RealtimeMessage = { topic: "tenant:t-1:comanda:s-1", type: "changed", data: {}, ts: 2, id: "e-1" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RealtimeChannel — a planned rotation", () => {
  it("opens the next stream first and retires the old one only once it is open", () => {
    const h = harness();
    h.source(0).onopen?.({});
    frame(h.source(0), ROTATE);
    expect(h.built).toHaveLength(2);
    expect(h.source(0).closed).toBe(false);

    h.source(1).onopen?.({});
    expect(h.source(0).closed).toBe(true);
    expect(h.statuses).toEqual(["connecting", "connected"]);
    h.channel.close();
  });

  it("delivers what either stream carries while both are open, and the new one after", () => {
    const h = harness();
    h.source(0).onopen?.({});
    frame(h.source(0), ROTATE);
    frame(h.source(1), HINT);
    h.source(1).onopen?.({});
    frame(h.source(1), { ...HINT, id: "e-2" });
    expect(h.messages.map((message) => message.id)).toEqual(["e-1", "e-2"]);
    h.channel.close();
  });

  it("keeps the old stream when the replacement fails, and recovers normally when it ends", () => {
    const h = harness();
    h.source(0).onopen?.({});
    frame(h.source(0), ROTATE);
    h.source(1).onerror?.({});
    expect(h.source(1).closed).toBe(true);
    expect(h.statuses.at(-1)).toBe("connected");

    // The server then ends the old stream: the ordinary reconnect path.
    h.source(0).onerror?.({});
    expect(h.statuses.at(-1)).toBe("disconnected");
    h.channel.close();
  });

  it("closes a replacement still opening when the channel is closed", () => {
    const h = harness();
    h.source(0).onopen?.({});
    frame(h.source(0), ROTATE);
    h.channel.close();
    expect(h.source(1).closed).toBe(true);
  });
});
