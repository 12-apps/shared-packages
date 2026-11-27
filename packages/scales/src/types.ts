export type Unsubscribe = () => void;

export interface SerialConfig {
  readonly baudRate: number;
  readonly dataBits: 7 | 8;
  readonly stopBits: 1 | 2;
  readonly parity: "none" | "even" | "odd";
  readonly dtr: boolean;
  readonly rts: boolean;
}

export interface UsbIds {
  readonly vendorId: number;
  readonly productId: number;
}

export interface ByteTransport {
  readonly usb?: UsbIds;
  open(config: SerialConfig): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  onData(listener: (bytes: Uint8Array) => void): Unsubscribe;
  onClose(listener: () => void): Unsubscribe;
}

export interface ScaleReading {
  readonly netGrams: number;
  readonly tareGrams: number;
  readonly stable: true | "inferred";
  readonly raw: Uint8Array;
}

export interface ScaleParser {
  push(bytes: Uint8Array): readonly ScaleReading[];
}

export interface ScaleProfile {
  readonly id: string;
  readonly label: string;
  readonly serial: SerialConfig;
  readonly request: { readonly kind: "stream" } | {
    readonly kind: "poll";
    readonly bytes: Uint8Array;
    readonly intervalMs: number;
  };
  readonly silence: "moving-or-invalid" | "no-reading";
  readonly usbHints: readonly UsbIds[];
  createParser(): ScaleParser;
}

export type ScaleEvent =
  | { readonly kind: "reading" | "settled"; readonly reading: ScaleReading }
  | { readonly kind: "silent"; readonly durationMs: number }
  | { readonly kind: "disconnected" | "reconnected" };
