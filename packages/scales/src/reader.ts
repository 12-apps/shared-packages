import { closeTransport, delay, runIo } from "./timing.js";
import type { ScaleRegistry } from "./registry.js";
import type { ByteTransport, ScaleEvent, ScaleProfile, ScaleReading, Unsubscribe } from "./types.js";

export interface ScaleReader {
  start(): void;
  stop(): Promise<void>;
  subscribe(listener: (event: ScaleEvent) => void): Unsubscribe;
}

interface ReaderOptions {
  readonly transport: ByteTransport;
  readonly registry: ScaleRegistry;
  readonly profile: string;
  readonly settleSamples?: number;
  readonly silenceMs?: number;
  readonly reconnectMs?: number;
}

function readingsHandler(push: (event: ScaleEvent) => void, settleSamples: number) {
  let previousGrams: number | undefined;
  let previousTare: number | undefined;
  let consecutive = 0;
  let waitingForZero = false;
  const accept = (reading: ScaleReading) => {
    const { netGrams, tareGrams } = reading;
    if (netGrams === 0) waitingForZero = false;
    consecutive = netGrams === previousGrams && tareGrams === previousTare ? consecutive + 1 : 1;
    previousGrams = netGrams;
    previousTare = tareGrams;
    push({ kind: "reading", reading });
    if (!waitingForZero && netGrams > 0 && consecutive >= settleSamples) {
      waitingForZero = true;
      push({ kind: "settled", reading });
    }
  };
  return { accept, resetSamples: () => { consecutive = 0; } };
}

async function connect(options: {
  transport: ByteTransport;
  profile: ScaleProfile;
  signal: AbortSignal;
  onOpen(): void;
  silenceMs: number;
  samples: ReturnType<typeof readingsHandler>;
  push(event: ScaleEvent): void;
}) {
  const { transport, profile, signal, onOpen, silenceMs, samples, push } = options;
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  signal.addEventListener("abort", disconnect, { once: true });
  const parser = profile.createParser();
  let lastReadingAt = Date.now();
  let wasSilent = false;
  const unsubscribeData = transport.onData((bytes) => {
    for (const reading of parser.push(bytes)) {
      if (controller.signal.aborted) return;
      const previousReadingAt = lastReadingAt;
      lastReadingAt = Date.now();
      wasSilent = false;
      if (Date.now() - previousReadingAt >= silenceMs) samples.resetSamples();
      samples.accept(reading);
    }
  });
  const unsubscribeClose = transport.onClose(disconnect);
  try {
    await runIo(() => transport.open(profile.serial), controller.signal, 15_000);
    if (signal.aborted || controller.signal.aborted) return;
    onOpen();
    lastReadingAt = Date.now();
    const { request } = profile;
    const interval = request.kind === "poll" ? request.intervalMs : 100;
    while (!controller.signal.aborted) {
      const startedAt = Date.now();
      const durationMs = startedAt - lastReadingAt;
      if (durationMs >= silenceMs && !wasSilent) {
        wasSilent = true;
        samples.resetSamples();
        push({ kind: "silent", durationMs });
      }
      if (request.kind === "poll") await runIo(() => transport.write(request.bytes), controller.signal, 1500);
      await delay(Math.max(0, interval - (Date.now() - startedAt)), controller.signal);
    }
  } finally {
    samples.resetSamples();
    unsubscribeData();
    unsubscribeClose();
    signal.removeEventListener("abort", disconnect);
    await closeTransport(transport);
  }
}

export function createScale(options: ReaderOptions): ScaleReader {
  const { transport, registry, profile } = options;
  const settleSamples = options.settleSamples ?? 2;
  const silenceMs = options.silenceMs ?? 1500;
  const reconnectMs = options.reconnectMs ?? 1000;
  if (!Number.isInteger(settleSamples) || settleSamples < 1) throw new Error("Invalid scale settle sample count");
  if (![silenceMs, reconnectMs].every((ms) => Number.isFinite(ms) && ms > 0)) throw new Error("Scale timings must be positive");
  let selected = profile === "auto" ? undefined : registry.get(profile);
  if (profile !== "auto" && !selected) throw new Error(`Unknown scale profile: ${profile}`);

  const listeners = new Set<(event: ScaleEvent) => void>();
  const push = (event: ScaleEvent) => {
    for (const listener of listeners) listener(event);
  };
  const samples = readingsHandler(push, settleSamples);
  let current: { control: AbortController; run: Promise<void> } | undefined;

  async function run(signal: AbortSignal): Promise<void> {
    let reportedDisconnect = false;
    const onOpen = () => {
      if (reportedDisconnect) push({ kind: "reconnected" });
      reportedDisconnect = false;
    };
    while (!signal.aborted) {
      try {
        selected ??= await registry.detect(transport, signal);
        if (selected && !signal.aborted) await connect({ transport, profile: selected, signal, onOpen, silenceMs, samples, push });
      } catch {
        // A missing or unplugged device is retried through the transport.
      }
      if (!signal.aborted && !reportedDisconnect) {
        reportedDisconnect = true;
        push({ kind: "disconnected" });
      }
      await delay(reconnectMs, signal);
    }
  }

  return {
    start() {
      if (current) return;
      const control = new AbortController();
      const promise = run(control.signal);
      current = { control, run: promise };
    },
    async stop() {
      if (!current) return;
      const active = current;
      active.control.abort();
      await active.run;
      if (current === active) current = undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
