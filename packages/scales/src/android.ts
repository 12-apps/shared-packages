import type { ByteTransport, SerialConfig, Unsubscribe, UsbIds } from "./types";

export interface AndroidSerialBridge {
  open(config: SerialConfig): Promise<void>;
  write(bytes: readonly number[]): Promise<void>;
  close(): Promise<void>;
  subscribeData(listener: (bytes: readonly number[]) => void): Unsubscribe;
  subscribeDisconnect(listener: () => void): Unsubscribe;
}

export function createAndroidSerialTransport(bridge: AndroidSerialBridge, usb?: UsbIds): ByteTransport {
  return {
    usb,
    open: (config) => bridge.open(config),
    write: (bytes) => bridge.write(Array.from(bytes)),
    close: () => bridge.close(),
    onData: (listener) => bridge.subscribeData((bytes) => listener(Uint8Array.from(bytes))),
    onClose: (listener) => bridge.subscribeDisconnect(listener),
  };
}
