import type { ByteTransport, SerialConfig, UsbIds } from "./types";

type Done = (error?: Error | null) => void;

export interface SerialPortHandle {
  readonly isOpen: boolean;
  open(done: Done): void;
  set(signals: { dtr: boolean; rts: boolean }, done: Done): void;
  write(bytes: Uint8Array, done: Done): unknown;
  close(done: Done): void;
  on(event: "data", listener: (bytes: Uint8Array) => void): unknown;
  on(event: "close" | "error", listener: () => void): unknown;
  off(event: "data", listener: (bytes: Uint8Array) => void): unknown;
  off(event: "close" | "error", listener: () => void): unknown;
}

function completed(operation: (done: Done) => void): Promise<void> {
  return new Promise((resolve, reject) => operation((error) => error ? reject(error) : resolve()));
}

export function createNodeSerialTransport(options: {
  readonly usb?: UsbIds;
  /** Create a serialport handle with autoOpen disabled. Re-resolve the path on reconnect. */
  createPort(config: SerialConfig): SerialPortHandle | Promise<SerialPortHandle>;
}): ByteTransport {
  const data = new Set<(bytes: Uint8Array) => void>();
  const closed = new Set<() => void>();
  let active: SerialPortHandle | undefined;
  let closing = false;
  const deliver = (bytes: Uint8Array) => {
    for (const listener of data) listener(bytes);
  };
  const disconnected = () => {
    if (!closing) for (const listener of closed) listener();
  };
  return {
    usb: options.usb,
    async open(config) {
      if (active) throw new Error("Serial transport is already open");
      const port = await options.createPort(config);
      active = port;
      port.on("data", deliver);
      port.on("close", disconnected);
      port.on("error", disconnected);
      await completed((done) => port.open(done));
      await completed((done) => port.set({ dtr: config.dtr, rts: config.rts }, done));
    },
    async write(bytes) {
      const port = active;
      if (!port?.isOpen) throw new Error("Serial port is closed");
      await completed((done) => void port.write(bytes, done));
    },
    async close() {
      const port = active;
      if (!port) return;
      closing = true;
      try {
        if (port.isOpen) await completed((done) => port.close(done));
      } finally {
        port.off("data", deliver);
        port.off("close", disconnected);
        port.off("error", disconnected);
        active = undefined;
        closing = false;
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
