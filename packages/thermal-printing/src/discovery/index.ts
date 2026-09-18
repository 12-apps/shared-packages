import { createConnection, type Socket } from "node:net";
import { networkInterfaces } from "node:os";

import { rangesFor, type InterfaceAddress, type ScanRange } from "./subnet";

export {
  MAX_SCAN_HOSTS,
  NARROW_TO_PREFIX,
  rangeFor,
  rangesFor,
  type InterfaceAddress,
  type ScanRange,
} from "./subnet";

/**
 * Finding the printer nobody wrote the address of down.
 *
 * The settings screen asks a shop owner for an IP address. That is a fair
 * question to ask a network engineer and an unfair one to ask somebody whose
 * job is selling lunch: the address was assigned by a router they have never
 * logged into, to a device with no screen. The field is where printer setup
 * stalls, and every hour it stalls is a shop printing nothing.
 *
 * So: knock on every door on the local network and see which ones answer on
 * the printing port. That is a port scan, and it is worth being plain about
 * what that does and does not buy.
 *
 * ## What an open port proves, and what it does not
 *
 * Nothing about the device. Anything may listen on 9100 — a Windows print
 * spooler, a second server, an unrelated appliance — and a bare TCP connect
 * cannot tell them apart. Reporting the first open port as "your printer"
 * would hand somebody a plausible wrong answer, which is worse than no answer,
 * because it fails later and somewhere else.
 *
 * Two things answer that. The probe asks a REAL ESC/POS QUESTION once
 * connected ({@link STATUS_QUERY}) and grades what comes back, so a device that
 * speaks the protocol is reported differently from one that merely opened the
 * port. And nothing here picks: every candidate is returned, graded, for a
 * human to confirm with a test page. **The test page is still the proof**, for
 * exactly the reason the rest of this package keeps repeating — the socket
 * never tells you the paper came out.
 *
 * Server-only and Node-only, like `../net`, and behind its own subpath for the
 * same reason: no browser bundle should ever drag `node:net` in.
 */

/** The port a raw ESC/POS printer listens on, by JetDirect convention. */
export const DEFAULT_PRINTER_PORT = 9100;

/**
 * How long one door gets to answer.
 *
 * Deliberately a fraction of `../net`'s connect budget, and the difference is
 * the point. There, we are talking to a printer somebody configured and a slow
 * answer is still the right answer, so waiting is correct. Here, we are trying
 * hundreds of addresses that are mostly nothing at all, on a LAN where a real
 * device replies in single-digit milliseconds. Anything still silent at half a
 * second is absent, and waiting four seconds for each of them would turn a
 * two-second sweep into a quarter of an hour.
 */
export const PROBE_TIMEOUT_MS = 500;

/** …and how long a device that DID answer gets to prove it is a printer. */
export const STATUS_TIMEOUT_MS = 400;

/**
 * How many doors at once.
 *
 * Every probe is an open file descriptor. The default soft limit on macOS is
 * 256 and on some Windows builds the effective ceiling is lower still, so a
 * sweep that opened a socket per address would not fail gracefully — it would
 * start reporting `EMFILE` as "no printer found", which is the worst possible
 * lie for this feature to tell. Sixty-four keeps a /24 under two seconds while
 * staying well inside every platform's floor.
 */
export const PROBE_CONCURRENCY = 64;

/**
 * `DLE EOT 1` — "transmit printer status", the real-time status request.
 *
 * The one question in ESC/POS that a printer answers immediately, out of band,
 * without printing anything: it returns a single status byte whether or not the
 * printer is busy, and it is safe to send to a device that turns out not to be
 * a printer at all — three bytes into a socket that is then closed.
 *
 * Support is not universal on the cheap end of this device class, so silence is
 * NOT evidence against a printer. It is only ever used to promote a candidate,
 * never to reject one.
 */
export const STATUS_QUERY = Uint8Array.from([0x10, 0x04, 0x01]);

/**
 * How sure we are, and the two values mean genuinely different things to a UI.
 *
 * `confirmed` — it answered an ESC/POS status request. Safe to offer as the
 * obvious choice.
 * `candidate` — the port is open and nothing more is known. Worth showing,
 * never worth auto-selecting on its own.
 */
export type PrinterConfidence = "confirmed" | "candidate";

export interface DiscoveredPrinter {
  host: string;
  port: number;
  confidence: PrinterConfidence;
  /** The status byte, when one came back. Diagnostics only — never parsed. */
  statusByte?: number;
}

export interface ScanOptions {
  port?: number;
  probeTimeoutMs?: number;
  statusTimeoutMs?: number;
  concurrency?: number;
  /** Overrides `os.networkInterfaces()`. The seam every test uses. */
  interfaces?: InterfaceAddress[];
  /** Stop the sweep early — a UI that was closed, or a timeout above this one. */
  signal?: AbortSignal;
  /** Called as each range starts, for a progress bar that is not a guess. */
  onRangeStart?: (range: ScanRange, index: number, total: number) => void;
}

export interface ScanResult {
  printers: DiscoveredPrinter[];
  /** Every range swept, so a UI can say WHERE it looked when it found nothing. */
  ranges: ScanRange[];
  /** True when `signal` cut the sweep short — the list may be incomplete. */
  aborted: boolean;
}

/** `os.networkInterfaces()` flattened into the shape {@link rangesFor} takes. */
export function localInterfaces(): InterfaceAddress[] {
  const flattened: InterfaceAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      flattened.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        family: entry.family as InterfaceAddress["family"],
        internal: entry.internal,
      });
    }
  }
  return flattened;
}

/**
 * Knock once.
 *
 * **Never throws**, on the same reasoning as `sendToNetworkPrinter`: every way
 * this fails is an ordinary address with nothing behind it, which is the
 * expected outcome for 253 of the 254 doors on a shop's network.
 */
export function probePrinter(
  host: string,
  port: number = DEFAULT_PRINTER_PORT,
  options: Pick<ScanOptions, "probeTimeoutMs" | "statusTimeoutMs"> = {},
): Promise<DiscoveredPrinter | null> {
  const probeTimeout = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const statusTimeout = options.statusTimeoutMs ?? STATUS_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    const finish = (result: DiscoveredPrinter | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    /**
     * Everything after a successful connect is at least a candidate.
     *
     * The connect ITSELF is the evidence: something accepted a TCP connection
     * on the printing port. Whether it then refused, reset or said nothing
     * changes only how sure we are, and a device that hangs up rudely is a
     * fair description of a good deal of this hardware. Grading those as
     * "nothing here" would hide the printer we are looking for.
     */
    const settleAfterConnect = (): void =>
      finish(connected ? { host, port, confidence: "candidate" } : null);

    const socket: Socket = createConnection({ host, port });
    socket.setTimeout(probeTimeout);

    // A closed port is the expected answer for almost every address swept, so
    // a pre-connect error is not logged, counted or surfaced — it is simply
    // "nothing lives here".
    socket.on("error", settleAfterConnect);
    socket.on("timeout", settleAfterConnect);
    // `close` always follows `end`, so it covers both the half-close and the
    // abrupt teardown; a separate `end` handler would only race it.
    socket.on("close", settleAfterConnect);
    socket.on("connect", () => {
      connected = true;
      socket.setTimeout(statusTimeout);
      socket.write(STATUS_QUERY, (error) => {
        // The port is open either way; a failed write only costs the grade.
        if (error) settleAfterConnect();
      });
    });
    socket.once("data", (chunk: Buffer) => {
      finish({
        host,
        port,
        confidence: "confirmed",
        ...(chunk.length > 0 ? { statusByte: chunk[0] } : {}),
      });
    });
  });
}

/** Run `work` over `items` with at most `limit` in flight, preserving order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await work(item);
    }
  };
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, () => runner()));
  return results;
}

/**
 * Sweep every local network for printers.
 *
 * Ranges are swept in ORDER rather than together — `rangesFor` has already put
 * the most plausible first, and a shop with Wi-Fi, Ethernet and a VPN adapter
 * up would otherwise pay for all three before answering about the one the
 * printer is actually on. It does not stop at the first find: a store with a
 * printer per setor has several, and showing one of them would send somebody
 * back to this screen for each of the others.
 */
export async function scanForPrinters(options: ScanOptions = {}): Promise<ScanResult> {
  const port = options.port ?? DEFAULT_PRINTER_PORT;
  const concurrency = options.concurrency ?? PROBE_CONCURRENCY;
  const ranges = rangesFor(options.interfaces ?? localInterfaces());
  const printers: DiscoveredPrinter[] = [];

  for (const [index, range] of ranges.entries()) {
    if (options.signal?.aborted) return { printers, ranges, aborted: true };
    options.onRangeStart?.(range, index, ranges.length);
    const found = await mapWithLimit(range.hosts, concurrency, (host) =>
      options.signal?.aborted
        ? Promise.resolve(null)
        : probePrinter(host, port, options),
    );
    for (const printer of found) {
      if (printer) printers.push(printer);
    }
  }

  // Confirmed first, so the one device that proved it speaks ESC/POS is the one
  // a UI offers by default. Ties hold the sweep's own order, which is ascending
  // by address — stable across runs, which matters for a screen somebody reads
  // twice.
  printers.sort((a, b) => {
    if (a.confidence === b.confidence) return 0;
    return a.confidence === "confirmed" ? -1 : 1;
  });
  return { printers, ranges, aborted: options.signal?.aborted ?? false };
}
