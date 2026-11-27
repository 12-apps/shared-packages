import type { ByteTransport, SerialConfig, UsbIds } from "./types.js";

export interface WebSerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(config: Pick<SerialConfig, "baudRate" | "dataBits" | "stopBits" | "parity">): Promise<void>;
  setSignals(signals: { dataTerminalReady: boolean; requestToSend: boolean }): Promise<void>;
  close(): Promise<void>;
}

function usbIds(port: WebSerialPort): UsbIds | undefined {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId !== undefined && usbProductId !== undefined) return { vendorId: usbVendorId, productId: usbProductId };
}

async function pump(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deliver: (bytes: Uint8Array) => void,
): Promise<void> {
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      deliver(result.value);
    }
  } catch {
    // Removal rejects a pending read and must follow the same close path.
  } finally {
    reader.releaseLock();
  }
}

export function createWebSerialTransport(port: WebSerialPort): ByteTransport {
  const data = new Set<(bytes: Uint8Array) => void>();
  const closed = new Set<() => void>();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let reading: Promise<void> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let opening = false;
  let generation = 0;
  let opened = false;
  let closing = false;
  return {
    usb: usbIds(port),
    async open({ dtr, rts, ...settings }) {
      if (opened || opening || closing) throw new Error("Web Serial port is unavailable");
      const session = ++generation;
      opening = true;
      try {
        await port.open(settings);
        if (session !== generation) {
          await port.close();
          throw new Error("Web Serial open was stopped");
        }
        opened = true;
      } finally {
        opening = false;
      }
      await port.setSignals({ dataTerminalReady: dtr, requestToSend: rts });
      if (session !== generation) throw new Error("Web Serial open was stopped");
      reader = port.readable?.getReader();
      if (!reader) throw new Error("Web Serial port has no readable stream");
      const active = reader;
      reading = pump(active, (bytes) => data.forEach((listener) => listener(bytes))).finally(() => {
        reader = undefined;
        if (!closing) closed.forEach((listener) => listener());
      });
    },
    async write(bytes) {
      const active = port.writable?.getWriter();
      if (!active) throw new Error("Web Serial port has no writable stream");
      writer = active;
      try {
        await active.write(bytes);
      } finally {
        if (writer === active) {
          writer = undefined;
          active.releaseLock();
        }
      }
    },
    async close() {
      generation++;
      if (!opened || closing) return;
      closing = true;
      try {
        const activeWriter = writer;
        writer = undefined;
        activeWriter?.releaseLock();
        await reader?.cancel().catch(() => undefined);
        await reading;
        await port.close();
      } finally {
        opened = false;
        closing = false;
        reading = undefined;
      }
    },
    onData(listener) {
      data.add(listener);
      return () => data.delete(listener);
    },
    onClose(listener) {
      closed.add(listener);
      return () => closed.delete(listener);
    },
  };
}
