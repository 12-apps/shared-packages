import type { ByteTransport, SerialConfig, UsbIds } from "./types";

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

export function createWebSerialTransport(port: WebSerialPort): ByteTransport {
  const data = new Set<(bytes: Uint8Array) => void>();
  const closed = new Set<() => void>();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let reading: Promise<void> | undefined;
  let opened = false;
  let closing = false;
  async function pump(active: ReadableStreamDefaultReader<Uint8Array>) {
    try {
      while (true) {
        const result = await active.read();
        if (result.done) break;
        for (const listener of data) listener(result.value);
      }
    } catch {
      // Removal rejects a pending read and must follow the same close path.
    } finally {
      active.releaseLock();
      reader = undefined;
      if (!closing) for (const listener of closed) listener();
    }
  }
  return {
    usb: usbIds(port),
    async open({ dtr, rts, ...settings }) {
      if (opened) throw new Error("Web Serial port is already open");
      await port.open(settings);
      opened = true;
      await port.setSignals({ dataTerminalReady: dtr, requestToSend: rts });
      reader = port.readable?.getReader();
      if (!reader) throw new Error("Web Serial port has no readable stream");
      reading = pump(reader);
    },
    async write(bytes) {
      const writer = port.writable?.getWriter();
      if (!writer) throw new Error("Web Serial port has no writable stream");
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    },
    async close() {
      if (!opened) return;
      closing = true;
      try {
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
