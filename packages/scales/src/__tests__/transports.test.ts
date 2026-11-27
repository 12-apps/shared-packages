import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAndroidSerialTransport } from "../android";
import { createNodeSerialTransport } from "../node";
import { createWebSerialTransport } from "../web";
import { createUranoParser, createUranoPopLight } from "../urano";
import { captures, frame } from "./urano-captures";

const uranoPopLight = createUranoPopLight("Urano US 31/2 POP Light");

const reading = () => expect.objectContaining({ netGrams: 428, tareGrams: 286 });

describe("scale byte transports", () => {
  it("sets the Node line signals and forwards bytes over serialport", async () => {
    const port = Object.assign(new EventEmitter(), {
      isOpen: false,
      open: vi.fn((done: () => void) => { port.isOpen = true; done(); }),
      set: vi.fn((_value: unknown, done: () => void) => done()),
      write: vi.fn((_value: unknown, done: () => void) => done()),
      close: vi.fn((done: () => void) => { port.isOpen = false; done(); }),
    });
    const signal = vi.fn();
    const parse = vi.fn(createUranoParser().push);
    const transport = createNodeSerialTransport({ createPort: () => port });
    transport.onData(parse);
    transport.onClose(signal);
    await transport.open(uranoPopLight.serial);
    await transport.write(Uint8Array.of(5));
    port.emit("data", frame(captures.second));
    port.emit("close");
    await transport.close();
    expect(port.set).toHaveBeenCalledWith({ dtr: true, rts: true }, expect.any(Function));
    expect(port.write).toHaveBeenCalledWith(Uint8Array.of(5), expect.any(Function));
    expect(parse).toHaveReturnedWith([reading()]);
    expect(signal).toHaveBeenCalledOnce();
    expect(port.listenerCount("data")).toBe(0);
  });


  it("retires a late Node open without publishing into a newer connection", async () => {
    const openFirst = vi.fn<(done: () => void) => void>();
    const first = Object.assign(new EventEmitter(), {
      isOpen: false,
      open: openFirst,
      set: vi.fn((_value: unknown, done: () => void) => done()),
      write: vi.fn((_value: unknown, done: () => void) => done()),
      close: vi.fn((done: () => void) => { first.isOpen = false; done(); }),
    });
    const second = Object.assign(new EventEmitter(), {
      isOpen: false,
      open(done: () => void) { second.isOpen = true; done(); },
      set: vi.fn((_value: unknown, done: () => void) => done()),
      write: vi.fn((_value: unknown, done: () => void) => done()),
      close: vi.fn((done: () => void) => { second.isOpen = false; done(); }),
    });
    const createPort = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const transport = createNodeSerialTransport({ createPort });
    const received = vi.fn();
    transport.onData(received);
    const abandoned = transport.open(uranoPopLight.serial);
    const rejection = expect(abandoned).rejects.toThrow("stopped");
    await Promise.resolve();
    const finishOpening = openFirst.mock.calls[0]?.[0];
    if (!finishOpening) throw new Error("Open did not start");
    await transport.close();
    await transport.open(uranoPopLight.serial);
    first.isOpen = true;
    finishOpening();
    first.emit("data", frame(captures.plate));
    await rejection;
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect(received).not.toHaveBeenCalled();
    await transport.close();
  });

  it("preserves unsigned bytes over the Android bridge", async () => {
    const open = vi.fn(async () => {});
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const parse = vi.fn(createUranoParser().push);
    const stop = vi.fn();
    const transport = createAndroidSerialTransport({
      open, write, close,
      subscribeData(listener) {
        listener(Array.from(frame(captures.second)));
        return stop;
      },
      subscribeDisconnect: () => stop,
    });
    const off = transport.onData(parse);
    await transport.open(uranoPopLight.serial);
    await transport.write(Uint8Array.of(5));
    await transport.close();
    off();
    expect(open).toHaveBeenCalledWith(uranoPopLight.serial);
    expect(write).toHaveBeenCalledWith([5]);
    expect(parse).toHaveReturnedWith([reading()]);
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reads and releases the Web Serial streams without reporting a manual close", async () => {
    const open = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const setSignals = vi.fn(async () => {});
    const write = vi.fn();
    const signal = vi.fn();
    const parser = createUranoParser();
    const port = {
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      readable: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(frame(captures.second)); },
      }),
      writable: new WritableStream<Uint8Array>({ write }),
      open, close, setSignals,
    };
    const transport = createWebSerialTransport(port);
    const read = new Promise<ReturnType<typeof parser.push>>((resolve) => {
      transport.onData((bytes) => resolve(parser.push(bytes)));
    });
    transport.onClose(signal);
    await transport.open(uranoPopLight.serial);
    const parsed = await read;
    await transport.write(Uint8Array.of(5));
    await transport.close();
    expect(transport.usb).toEqual({ vendorId: 0x1a86, productId: 0x7523 });
    expect(parsed).toEqual([reading()]);
    expect(setSignals).toHaveBeenCalledWith({ dataTerminalReady: true, requestToSend: true });
    expect(write).toHaveBeenCalledWith(Uint8Array.of(5), expect.anything());
    expect(signal).not.toHaveBeenCalled();
    expect(port.readable.locked).toBe(false);
    expect(port.writable.locked).toBe(false);
  });
});
