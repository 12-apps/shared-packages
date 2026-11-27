import { afterEach, describe, expect, it, vi } from "vitest";
import { createScale } from "../reader";
import { createScaleRegistry } from "../registry";
import type { ByteTransport, ScaleEvent, SerialConfig } from "../types";
import { createUranoPopLight } from "../urano";
import { captures, frame } from "./urano-captures";

const uranoPopLight = createUranoPopLight("Urano US 31/2 POP Light");

function fakeTransport({ respondOnOpen = false }: { respondOnOpen?: boolean } = {}) {
  const data = new Set<(bytes: Uint8Array) => void>();
  const closed = new Set<() => void>();
  const send = (hex: string) => { for (const listener of data) listener(frame(hex)); };
  const transport = {
    open: vi.fn<(config: SerialConfig) => Promise<void>>(async () => {
      if (respondOnOpen) send(captures.empty);
    }),
    write: vi.fn<(bytes: Uint8Array) => Promise<void>>(async () => {}),
    close: vi.fn(async () => {}),
    onData(listener) {
      data.add(listener);
      return () => data.delete(listener);
    },
    onClose(listener) {
      closed.add(listener);
      return () => closed.delete(listener);
    },
  } satisfies ByteTransport;
  return { transport, send, unplug: () => { for (const listener of closed) listener(); } };
}

const registry = createScaleRegistry([uranoPopLight]);

afterEach(() => vi.useRealTimers());

describe("scale reader", () => {
  it("settles twice only after returning to zero and retries the transport after removal", async () => {
    vi.useFakeTimers();
    const { transport, send, unplug } = fakeTransport();
    const reader = createScale({ transport, registry, profile: uranoPopLight.id, reconnectMs: 100 });
    const events: ScaleEvent[] = [];
    reader.subscribe((event) => events.push(event));
    reader.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.write).toHaveBeenCalledWith(Uint8Array.of(5));
    for (const raw of [captures.empty, captures.plate, captures.plate, captures.second, captures.second]) send(raw);
    unplug();
    await vi.advanceTimersByTimeAsync(100);
    for (const raw of [captures.second, captures.second, captures.empty, captures.second, captures.second]) send(raw);
    await reader.stop();
    expect(events.flatMap((event) => event.kind === "settled" ? [event.reading.netGrams] : [])).toEqual([286, 428]);
    expect(events.some((event) => event.kind === "disconnected")).toBe(true);
    expect(events.some((event) => event.kind === "reconnected")).toBe(true);
    expect(transport.close).toHaveBeenCalledTimes(2);
  });

  it("reports silence once and requires fresh samples after it", async () => {
    vi.useFakeTimers();
    const { transport, send } = fakeTransport();
    const reader = createScale({ transport, registry, profile: uranoPopLight.id });
    const events: ScaleEvent[] = [];
    reader.subscribe((event) => events.push(event));
    reader.start();
    await vi.advanceTimersByTimeAsync(0);
    send(captures.plate);
    await vi.advanceTimersByTimeAsync(2500);
    send(captures.plate);
    expect(events.filter((event) => event.kind === "silent")).toEqual([{ kind: "silent", durationMs: 1500 }]);
    expect(events.some((event) => event.kind === "settled")).toBe(false);
    send(captures.plate);
    expect(events.at(-1)?.kind).toBe("settled");
    await reader.stop();
  });


  it("stops and closes when an in-flight write never replies", async () => {
    vi.useFakeTimers();
    const { transport } = fakeTransport();
    transport.write.mockImplementation(() => new Promise(() => {}));
    const reader = createScale({ transport, registry, profile: uranoPopLight.id });
    reader.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.write).toHaveBeenCalledOnce();
    await reader.stop();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("bounds probing across a stalled open and a stalled write", async () => {
    vi.useFakeTimers();
    const { transport } = fakeTransport();
    transport.open.mockImplementationOnce(() => new Promise(() => {}));
    transport.write.mockImplementation(() => new Promise(() => {}));
    const second = { ...uranoPopLight, id: "second" };
    const probing = createScaleRegistry([uranoPopLight, second]).detect(transport);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(probing).resolves.toBeUndefined();
    expect(transport.open).toHaveBeenCalledTimes(2);
    expect(transport.close).toHaveBeenCalledTimes(2);
  });

  it("keeps a streaming profile that emits its first sample while opening", async () => {
    const streaming = { ...uranoPopLight, id: "stream", request: { kind: "stream" } as const };
    const noMatch = { ...uranoPopLight, id: "unmatched", createParser: () => ({ push: () => [] }) };
    const { transport } = fakeTransport({ respondOnOpen: true });
    const detected = await createScaleRegistry([streaming, noMatch]).detect(transport);
    expect(detected?.id).toBe(streaming.id);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.write).not.toHaveBeenCalled();
  });
});
