import type { TypedBookAnswer } from '@12-apps/payments-backend/terminal';

import { captureWireOf, type CaptureWire, type TerminalCaptureTrace } from './port';

/**
 * Captures someone typed on the terminal and charged with no sale behind it
 * (FUT-4997), as a station's screen receives them from the link's
 * `typed-captures` event. Each is first offered to the sales whose amount
 * still due equals it; otherwise, or when the operator says it is none of
 * them, it is booked as a sale of its own through the host's server.
 *
 * - A matching capture waits for a person, with no timeout: it is never
 *   booked by itself.
 * - The terminal is told (`ack`) only after the server answered that the
 *   capture is accounted for — booked, or held by a sale — or after the sale it
 *   was tapped onto settled. Never on receipt, never while the server is out
 *   of reach, never while no session is open.
 * - A resend of a capture already accounted for is acknowledged again from
 *   memory; one being asked or booked is not booked twice.
 *
 * Headless: a store a screen subscribes to. The words and the band are the
 * host's.
 */

/** A sale a typed capture may belong to: the host's own key and what is still due on it. */
export interface DueSale {
  readonly key: string;
  readonly dueCents: number;
}

/** The sales whose amount still due equals the capture's, in the order given. A sale with nothing due never matches. */
export function matchTypedCapture<S extends DueSale>(capture: { readonly amountCents: number }, dueSales: readonly S[]): S[] {
  if (!(capture.amountCents > 0)) return [];
  return dueSales.filter((sale) => sale.dueCents > 0 && sale.dueCents === capture.amountCents);
}

/**
 * Where a typed capture stands on the screen:
 * - `asking`: on the band, waiting for a person (a match, or booking refused by the host's policy);
 * - `booking`: the server is being asked;
 * - `held`: tapped onto a sale; acknowledged once that sale settles;
 * - `waiting`: the server could not book it yet (`waitingFor` says why);
 * - `done`: accounted for and acknowledged.
 */
export type TypedEntryState = 'asking' | 'booking' | 'held' | 'waiting' | 'done';

/** Why a capture waits: no open session, the server out of reach, a transient refusal, or a refusal for a person. */
export type TypedWait = 'session' | 'link' | 'retry' | 'refused';

export interface TypedEntry<S extends DueSale = DueSale> {
  readonly deviceId: string;
  readonly capture: CaptureWire;
  readonly state: TypedEntryState;
  readonly matches: readonly S[];
  /** "None of these: book it on its own" may be offered. */
  readonly standalone: boolean;
  readonly waitingFor: TypedWait | null;
  /** The sale it was tapped onto. */
  readonly saleKey: string | null;
  /** The server's last answer. */
  readonly answer: TypedBookAnswer | null;
}

export interface TypedCaptureInboxConfig<S extends DueSale = DueSale> {
  /** Ask the host's server to book the capture on its own. A throw means the server could not be reached. */
  book(deviceId: string, capture: CaptureWire): Promise<TypedBookAnswer>;
  /** Tell the terminal it may stop reporting these codes. */
  ack(deviceId: string, transactionCodes: readonly string[]): unknown;
  /** The open sales and what is still due on each, now. */
  dueSales(): readonly S[];
  /** Whether a capture may be booked on its own at all (the host's policy, as the screen knows it). Default: yes. */
  standaloneAllowed?(): boolean;
  /** Each answer the server gave, after the entry moved (the host's notice). */
  onAnswer?(entry: TypedEntry<S>): void;
}

export interface TypedCaptureInbox<S extends DueSale = DueSale> {
  /** The link's `typed-captures` event. */
  received(event: { readonly deviceId: string; readonly captures: readonly TerminalCaptureTrace[] }): void;
  /** "Is it this sale?" answered yes: the capture to hold under that sale's key, or null when it is not asking. */
  chooseSale(transactionCode: string, key: string): CaptureWire | null;
  /** "None of these": book it on its own. False when that is not offered. */
  chooseStandalone(transactionCode: string): boolean;
  /** The sales these captures were tapped onto settled with them: acknowledge them. */
  bound(transactionCodes: readonly string[]): void;
  /** Ask the server again for every capture that waits (a session opened, the link came back). */
  retry(): void;
  entries(): readonly TypedEntry<S>[];
  /** What still waits for a person: shown to resolve at the end of a shift. */
  unanswered(): readonly TypedEntry<S>[];
  subscribe(listener: () => void): () => void;
}

const RETRIABLE: ReadonlySet<TypedWait> = new Set<TypedWait>(['session', 'link', 'retry']);

/** Where an entry goes on an answer that did not account for it. */
function unackedPatch<S extends DueSale>(answer: TypedBookAnswer): Partial<TypedEntry<S>> {
  if (answer.outcome === 'NOT_ALLOWED') return { state: 'asking', standalone: false, waitingFor: null, answer };
  if (answer.outcome === 'WAITING') return { state: 'waiting', waitingFor: 'session', answer };
  const wait: TypedWait = answer.outcome === 'REFUSED' && answer.code === 'CONTENDED' ? 'retry' : 'refused';
  return { state: 'waiting', waitingFor: wait, answer };
}

/** The entries by code, and who listens to them. */
function entryStore<S extends DueSale>() {
  const byCode = new Map<string, TypedEntry<S>>();
  const listeners = new Set<() => void>();
  return {
    byCode,
    put(entry: TypedEntry<S>, patch: Partial<TypedEntry<S>>): TypedEntry<S> {
      const next = { ...entry, ...patch };
      byCode.set(entry.capture.transactionCode, next);
      [...listeners].forEach((listener) => listener());
      return next;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function createTypedCaptureInbox<S extends DueSale = DueSale>(config: TypedCaptureInboxConfig<S>): TypedCaptureInbox<S> {
  const { byCode, put, subscribe } = entryStore<S>();

  async function book(entry: TypedEntry<S>): Promise<void> {
    const asked = put(entry, { state: 'booking', waitingFor: null });
    let answer: TypedBookAnswer;
    try {
      answer = await config.book(asked.deviceId, asked.capture);
    } catch {
      put(asked, { state: 'waiting', waitingFor: 'link' });
      return;
    }
    if (answer.ack) config.ack(asked.deviceId, [asked.capture.transactionCode]);
    config.onAnswer?.(put(asked, answer.ack ? { state: 'done', waitingFor: null, answer } : unackedPatch<S>(answer)));
  }

  function arrived(deviceId: string, trace: TerminalCaptureTrace): void {
    const known = byCode.get(trace.transactionCode);
    if (known !== undefined) {
      // The terminal did not hear the first acknowledgement: tell it again, book nothing.
      if (known.state === 'done') config.ack(known.deviceId, [trace.transactionCode]);
      return;
    }
    const capture = captureWireOf(trace, deviceId);
    const matches = matchTypedCapture(capture, config.dueSales());
    const standalone = config.standaloneAllowed?.() ?? true;
    const entry: TypedEntry<S> = { deviceId, capture, state: 'asking', matches, standalone, waitingFor: null, saleKey: null, answer: null };
    if (matches.length > 0 || !standalone) put(entry, {});
    else void book(entry);
  }

  return {
    received: (event) => event.captures.forEach((trace) => arrived(event.deviceId, trace)),
    chooseSale(transactionCode, key) {
      const entry = byCode.get(transactionCode);
      return entry?.state === 'asking' ? put(entry, { state: 'held', saleKey: key }).capture : null;
    },
    chooseStandalone(transactionCode) {
      const entry = byCode.get(transactionCode);
      if (entry?.state !== 'asking' || !entry.standalone) return false;
      void book(entry);
      return true;
    },
    bound(transactionCodes) {
      transactionCodes.forEach((code) => {
        const entry = byCode.get(code);
        if (entry?.state !== 'held') return;
        config.ack(entry.deviceId, [code]);
        put(entry, { state: 'done' });
      });
    },
    retry() {
      [...byCode.values()]
        .filter((entry) => entry.state === 'waiting' && entry.waitingFor !== null && RETRIABLE.has(entry.waitingFor))
        .forEach((entry) => void book(entry));
    },
    entries: () => [...byCode.values()],
    unanswered: () => [...byCode.values()].filter((entry) => entry.state === 'asking'),
    subscribe,
  };
}
