import type { ByteTransport, SerialConfig, UsbIds } from "./types.js";

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

interface Connection {
  port?: SerialPortHandle;
  opening: boolean;
  closed?: Promise<void>;
  detach?: () => void;
}

function completed(operation: (done: Done) => void): Promise<void> {
  return new Promise((resolve, reject) => operation((error) => error ? reject(error) : resolve()));
}

function retire(connection: Connection): Promise<void> {
  connection.closed ??= (async () => {
    try {
      const { port } = connection;
      if (port?.isOpen) await completed((done) => port.close(done));
    } finally {
      connection.detach?.();
    }
  })();
  return connection.closed;
}

export function createNodeSerialTransport(options: {
  readonly usb?: UsbIds;
  /** Create a fresh serialport handle with autoOpen disabled. Re-resolve the path on reconnect. */
  createPort(config: SerialConfig): SerialPortHandle | Promise<SerialPortHandle>;
}): ByteTransport {
  const data = new Set<(bytes: Uint8Array) => void>();
  const closed = new Set<() => void>();
  let active: Connection | undefined;

  function listen(port: SerialPortHandle, connection: Connection) {
    const deliver = (bytes: Uint8Array) => {
      if (active === connection) for (const listener of data) listener(bytes);
    };
    const disconnect = () => {
      if (active === connection) for (const listener of closed) listener();
    };
    port.on("data", deliver);
    port.on("close", disconnect);
    port.on("error", disconnect);
    return () => {
      port.off("data", deliver);
      port.off("close", disconnect);
      port.off("error", disconnect);
    };
  }

  return {
    usb: options.usb,
    async open(config) {
      if (active) throw new Error("Serial transport is already open");
      const connection: Connection = { opening: false };
      active = connection;
      try {
        const port = await options.createPort(config);
        if (active !== connection) throw new Error("Serial open was stopped");
        connection.port = port;
        connection.detach = listen(port, connection);
        connection.opening = true;
        try {
          await completed((done) => port.open(done));
        } finally {
          connection.opening = false;
        }
        if (active !== connection) throw new Error("Serial open was stopped");
        await completed((done) => port.set({ dtr: config.dtr, rts: config.rts }, done));
      } catch (error) {
        if (active === connection) active = undefined;
        await retire(connection).catch(() => undefined);
        throw error;
      }
    },
    async write(bytes) {
      const port = active?.port;
      if (!port?.isOpen) throw new Error("Serial port is closed");
      await completed((done) => void port.write(bytes, done));
    },
    async close() {
      const connection = active;
      active = undefined;
      // A non-cancellable open belongs to its own handle. If it succeeds later
      // its open continuation retires it without touching the next connection.
      if (connection && !connection.opening) await retire(connection);
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
