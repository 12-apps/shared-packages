import { closeTransport, delay, runIo } from "./timing.js";
import type { ByteTransport, ScaleProfile, UsbIds } from "./types.js";

const PROBE_MS = 1500;

export interface ScaleRegistry {
  get(id: string): ScaleProfile | undefined;
  list(): readonly ScaleProfile[];
  detect(transport: ByteTransport, signal?: AbortSignal): Promise<ScaleProfile | undefined>;
}

function matchesUsb(profile: ScaleProfile, usb: UsbIds | undefined): boolean {
  return usb !== undefined && profile.usbHints.some(
    (hint) => hint.vendorId === usb.vendorId && hint.productId === usb.productId,
  );
}

async function probe(transport: ByteTransport, profile: ScaleProfile, signal?: AbortSignal): Promise<boolean> {
  const stopped = new AbortController();
  const abort = () => stopped.abort();
  const parser = profile.createParser();
  let matched = false;
  const unsubscribeData = transport.onData((bytes) => {
    if (!stopped.signal.aborted && parser.push(bytes).length > 0) {
      matched = true;
      abort();
    }
  });
  const unsubscribeClose = transport.onClose(abort);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, PROBE_MS);

  try {
    if (signal?.aborted) return false;
    await runIo(() => transport.open(profile.serial), stopped.signal);
    const { request } = profile;
    if (request.kind === "poll") {
      while (!stopped.signal.aborted) {
        const started = Date.now();
        await runIo(() => transport.write(request.bytes), stopped.signal);
        await delay(Math.max(0, request.intervalMs - (Date.now() - started)), stopped.signal);
      }
    } else {
      await delay(PROBE_MS, stopped.signal);
    }
  } catch {
    // A matching frame, stop, or I/O failure can interrupt the loop.
  } finally {
    clearTimeout(timer);
    unsubscribeData();
    unsubscribeClose();
    signal?.removeEventListener("abort", abort);
    await closeTransport(transport);
  }
  return matched && !signal?.aborted;
}

export function createScaleRegistry(profiles: readonly ScaleProfile[]): ScaleRegistry {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  if (byId.size !== profiles.length) throw new Error("Scale profile IDs must be unique");
  const choices = [...byId.values()];
  return {
    get: (id) => byId.get(id),
    list: () => [...choices],
    async detect(transport, signal) {
      const ordered = [...choices].sort((a, b) => Number(matchesUsb(b, transport.usb)) - Number(matchesUsb(a, transport.usb)));
      for (const profile of ordered) {
        if (signal?.aborted) return;
        if (await probe(transport, profile, signal)) return profile;
      }
    },
  };
}
