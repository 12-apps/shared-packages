import { join } from "node:path";

import type { StationCaptureWire as TerminalCaptureWire } from "../terminal/readers";
import type { CaptureTrace } from "../terminal-link";

import type { TerminalEvent } from "./terminal-contract";

/**
 * The captures the station's LAN link heard, for its offline journal.
 *
 * While the server is away the station keeps charging card and Pix on its
 * paired terminal. The journal entry carries each capture on its leg, so the
 * sync records it and binds it to the sale in the entry's own transaction
 * (`../terminal`'s non-refusing binder). Only the station journals a station
 * sale, so a sale is never created twice; the terminal only reports the
 * capture itself.
 *
 * - **Heard, never told.** The page is not trusted: it names a leg's capture
 *   by its transaction code only. What goes on the leg is the trace THIS
 *   process heard from a linked terminal over the signed channel
 *   (`./terminal-link.ts`): an approval, or a late one for a released charge.
 *   Codes are kept trimmed, as the page's request is read.
 * - **One capture, one sale.** A capture is claimed for the entry it is
 *   journaled under; another entry naming it is refused (`TAKEN`), the same
 *   entry again — a resend of that sale — is not.
 * - **Durable.** Kept in `terminal-captures.json` beside the station's other
 *   files, replaced atomically and fsynced ({@link CaptureBookFiles}), so a
 *   restart between the approval and the sale forgets nothing. The newest
 *   {@link MAX_KEPT} are kept; a garbled file reads as empty.
 */

/**
 * The two durable file moves the book needs, behind a port: a host's
 * durable-files helper fits it as it is.
 */
export interface CaptureBookFiles {
  /** The file's text, or `null` when it does not exist. */
  read(file: string): Promise<string | null>;
  /** Write a whole file atomically and durably: a reader sees the old file or the new, never half. */
  replace(file: string, text: string): Promise<void>;
}

/** How many captures are kept. A sale has at most a handful of legs. */
export const MAX_KEPT = 256;

const FILE = "terminal-captures.json";

/** A heard trace as the journal's leg carries it (the station capture wire): the protocol's names mapped onto the record's. */
export function captureWireOf(deviceId: string, trace: CaptureTrace): TerminalCaptureWire {
  return {
    transactionCode: trace.transactionCode.trim(),
    kind: trace.kind,
    amountCents: trace.amountCents,
    capturedAt: trace.capturedAt,
    transactionId: trace.transactionId,
    hostNsu: null,
    authorizationCode: trace.authorizationCode,
    cardBrand: trace.brand,
    installments: trace.installments,
    terminalSerial: trace.serial,
    entryMode: trace.entryMode,
    deviceId,
  };
}

/** The approved capture an event carries, with the device that took it; null for any other event. */
function heardOf(event: TerminalEvent): TerminalCaptureWire | null {
  if (event.kind !== "status" && event.kind !== "orphan-capture") return null;
  if (event.state !== "approved" || event.capture === undefined) return null;
  return captureWireOf(event.deviceId, event.capture);
}

/** One code the book knows: what was heard under it (null when only claimed), and the entry it was journaled under. */
interface Kept {
  wire: TerminalCaptureWire | null;
  entryId: string | null;
}

/** What a claim answered: the heard capture (null when never heard), or `TAKEN` by another entry. */
export type Claim = { readonly ok: true; readonly wire: TerminalCaptureWire | null } | { readonly ok: false };

export interface LanCaptureBook {
  /** Every event the LAN link emits: an approval's capture is kept. */
  observe(event: TerminalEvent): void;
  /** `send`, observing every event on its way: the terminal wiring's `broadcast`. */
  tap<C>(send: (channel: C, event: TerminalEvent) => void): (channel: C, event: TerminalEvent) => void;
  /** Claim `code` for `entryId` now, before any other sale can: refused when another entry holds it. */
  claim(code: string, entryId: string): Promise<Claim>;
  /** The claims of `entryId` let go: its sale was not journaled. */
  release(entryId: string): Promise<void>;
  /** Every write so far is on disk. */
  settled(): Promise<void>;
}

function keptOf(raw: string | null): Map<string, Kept> {
  const kept = new Map<string, Kept>();
  try {
    const rows = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(rows)) return kept;
    for (const row of rows as { code?: unknown; wire?: unknown; entryId?: unknown }[]) {
      if (typeof row.code !== "string") continue;
      const wire = typeof row.wire === "object" && row.wire !== null ? (row.wire as TerminalCaptureWire) : null;
      kept.set(row.code, { wire, entryId: typeof row.entryId === "string" ? row.entryId : null });
    }
  } catch {
    // Garbled: read as empty.
  }
  return kept;
}

export interface BookDeps {
  /** Where the book lives (the app's data directory). Read lazily, so the book can be made before the app is ready. */
  readonly directory: () => string;
  readonly files: CaptureBookFiles;
  readonly log?: (message: string) => void;
}

export function createLanCaptureBook(deps: BookDeps): LanCaptureBook {
  let kept: Map<string, Kept> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const file = () => join(deps.directory(), FILE);
  /** One read or write at a time, in the order asked. */
  const serial = <T>(run: (book: Map<string, Kept>) => Promise<T> | T): Promise<T> => {
    const next = chain.then(async () => {
      kept ??= keptOf(await deps.files.read(file()));
      return run(kept);
    });
    chain = next.catch(() => undefined);
    return next;
  };
  const save = async (book: Map<string, Kept>): Promise<void> => {
    while (book.size > MAX_KEPT) book.delete(book.keys().next().value!);
    await deps.files.replace(file(), JSON.stringify([...book].map(([code, row]) => ({ code, ...row }))));
  };
  const self: LanCaptureBook = {
    observe(event) {
      const wire = heardOf(event);
      if (wire === null) return;
      serial(async (book) => {
        const entryId = book.get(wire.transactionCode)?.entryId ?? null;
        book.delete(wire.transactionCode);
        book.set(wire.transactionCode, { wire, entryId });
        await save(book);
      }).catch((error: unknown) => deps.log?.(`terminal-link: a heard capture was not kept on disk: ${String(error)}`));
    },
    tap: (send) => (channel, event) => {
      self.observe(event);
      send(channel, event);
    },
    claim: (code, entryId) =>
      serial(async (book) => {
        const row = book.get(code);
        if (row?.entryId != null && row.entryId !== entryId) return { ok: false as const };
        book.set(code, { wire: row?.wire ?? null, entryId });
        await save(book);
        return { ok: true as const, wire: row?.wire ?? null };
      }),
    release: (entryId) =>
      serial(async (book) => {
        for (const [code, row] of book) if (row.entryId === entryId) book.set(code, { ...row, entryId: null });
        await save(book);
      }),
    settled: () => serial(() => undefined),
  };
  return self;
}
