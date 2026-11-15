import type { TypedBookAnswer } from '../server';

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
 * - A capture the refund sweep flagged `UNBOUND_TIMEOUT` (the server answers
 *   `FLAGGED_TIMEOUT`) waits on the band with `flaggedAt`: its money may
 *   already have been refunded on the terminal, so only a person's "on its
 *   own" books it, confirming that flag (D9-R22); an arrival or a retry never.
 *
 * - The matches are the sales due NOW: recomputed whenever the entries are
 *   read and when a sale is chosen, so a sale paid meanwhile is never offered.
 *
 * **One inbox per station.** The match is made on the page, so two pages on
 * one station's events could answer the same capture differently (one asks,
 * the other books it). The host runs ONE inbox per station; the server only
 * guarantees that the capture is booked or bound once.
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

/** How the sale a capture was tapped onto left without it, as the host knows it. */
export type TypedUnholdReason = 'paid-elsewhere' | 'cancelled' | 'discarded';

/** The sale a capture was tapped onto, and how it left without it (`unhold`). */
export interface TypedUnheld {
  readonly saleKey: string;
  /** Null when the host did not say. */
  readonly reason: TypedUnholdReason | null;
}

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
  /**
   * Put back on the band by `unhold`: the sale it was tapped onto left without
   * it. Such a capture is never booked by itself, even when nothing matches;
   * only a person's "on its own" books it. A late `bound` still settles it.
   */
  readonly unheldFrom: TypedUnheld | null;
  /**
   * When the refund sweep flagged it `UNBOUND_TIMEOUT` ("A estornar"), as the
   * server's `FLAGGED_TIMEOUT` answer said (ISO); null otherwise. Such a capture
   * is booked only by `chooseStandalone`, which confirms this flag.
   */
  readonly flaggedAt: string | null;
}

export interface TypedCaptureInboxConfig<S extends DueSale = DueSale> {
  /**
   * Ask the host's server to book the capture on its own. A throw means the
   * server could not be reached. `confirmedFlaggedAt`: the `UNBOUND_TIMEOUT`
   * flag a person confirmed booking anyway (`chooseStandalone` on an entry
   * with `flaggedAt`), null on every other call; the server passes it to
   * `timeoutHold`.
   */
  book(deviceId: string, capture: CaptureWire, confirmedFlaggedAt: string | null): Promise<TypedBookAnswer>;
  /** Tell the terminal it may stop reporting these codes. A throw (or a rejection) leaves the capture to tell again. */
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
  /** "None of these": book it on its own, confirming its `flaggedAt` when it has one. False when that is not offered. */
  chooseStandalone(transactionCode: string): boolean;
  /**
   * The sales these captures were tapped onto settled with them: acknowledge
   * them. It also takes a capture `unhold` put back that nobody has answered
   * since: the bind wins over the unhold.
   */
  bound(transactionCodes: readonly string[]): void;
  /**
   * The sales these captures were tapped onto left without them (paid another
   * way, cancelled, discarded): put each back on the band, `held` → `asking`,
   * its matches recomputed against the sales due now and `unheldFrom` naming
   * the sale and how it left. It never acknowledges the terminal and never
   * books, now or later by itself, even when nothing matches. A code that is
   * not held, or whose sale already settled with it (`waitingFor: 'link'`,
   * only the acknowledgement is left), is left as it is, so a second call
   * changes nothing. Call it only once the sale left WITHOUT this page settling
   * it with the capture; a `bound` that comes after still wins.
   */
  unhold(transactionCodes: readonly string[], reason?: TypedUnholdReason): void;
  /**
   * Ask again for everything that waits: no session, the link down, a refusal a
   * person may since have resolved, a policy that refused (once it allows),
   * and an acknowledgement the terminal did not take.
   */
  retry(): void;
  /** Every capture, its matches recomputed against the sales due now. */
  entries(): readonly TypedEntry<S>[];
  /** What still waits for a person: on the band, or tapped onto a sale not settled yet. Shown at the end of a shift. */
  unanswered(): readonly TypedEntry<S>[];
  subscribe(listener: () => void): () => void;
}

/** Where an entry goes on an answer that did not account for it. */
function unackedPatch<S extends DueSale>(answer: TypedBookAnswer): Partial<TypedEntry<S>> {
  if (answer.outcome === 'NOT_ALLOWED') return { state: 'asking', standalone: false, waitingFor: null, answer };
  if (answer.outcome === 'FLAGGED_TIMEOUT') return { state: 'asking', standalone: true, waitingFor: null, flaggedAt: answer.flaggedAt, answer };
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

/** Tell the terminal; false when the call threw or rejected. */
async function told(config: Pick<TypedCaptureInboxConfig<DueSale>, 'ack'>, entry: { deviceId: string; capture: CaptureWire }): Promise<boolean> {
  try {
    await config.ack(entry.deviceId, [entry.capture.transactionCode]);
    return true;
  } catch {
    return false;
  }
}

/** A capture on the band that the policy kept off "on its own", and nothing it matches: it may be booked once allowed. */
const policyHeld = <S extends DueSale>(entry: TypedEntry<S>): boolean => entry.state === 'asking' && !entry.standalone;

/** The entries among these codes, each once, that pass the test. */
function among<S extends DueSale>(byCode: ReadonlyMap<string, TypedEntry<S>>, codes: readonly string[], test: (entry: TypedEntry<S>) => boolean): TypedEntry<S>[] {
  return [...new Set(codes)].flatMap((code) => {
    const entry = byCode.get(code);
    return entry !== undefined && test(entry) ? [entry] : [];
  });
}

/** A sale's settle takes it: held, or put back by `unhold` and not answered since (the bind wins). */
const settleable = <S extends DueSale>(entry: TypedEntry<S>): boolean => entry.state === 'held' || (entry.state === 'asking' && entry.unheldFrom !== null);

/** `unhold` moves it: held, with its sale not settled yet. */
const unholdable = <S extends DueSale>(entry: TypedEntry<S>): boolean => entry.state === 'held' && entry.waitingFor === null && entry.saleKey !== null;

/** Back on the band, naming the sale it left. */
function unheldPatch<S extends DueSale>(entry: TypedEntry<S>, matches: readonly S[], standalone: boolean, reason: TypedUnholdReason | undefined): Partial<TypedEntry<S>> {
  const unheldFrom: TypedUnheld = { saleKey: entry.saleKey ?? '', reason: reason ?? null };
  return { state: 'asking', saleKey: null, matches, standalone, waitingFor: null, unheldFrom };
}

export function createTypedCaptureInbox<S extends DueSale = DueSale>(config: TypedCaptureInboxConfig<S>): TypedCaptureInbox<S> {
  const { byCode, put, subscribe } = entryStore<S>();
  const allowed = (): boolean => config.standaloneAllowed?.() ?? true;
  const current = (entry: TypedEntry<S>): readonly S[] => matchTypedCapture(entry.capture, config.dueSales());

  async function book(entry: TypedEntry<S>, confirmedFlaggedAt: string | null = null): Promise<void> {
    const asked = put(entry, { state: 'booking', waitingFor: null });
    let answer: TypedBookAnswer;
    try {
      answer = await config.book(asked.deviceId, asked.capture, confirmedFlaggedAt);
    } catch {
      put(asked, { state: 'waiting', waitingFor: 'link' });
      return;
    }
    let patch: Partial<TypedEntry<S>> = unackedPatch<S>(answer);
    if (answer.ack) patch = (await told(config, asked)) ? { state: 'done', waitingFor: null, flaggedAt: null, answer } : { state: 'waiting', waitingFor: 'link', answer };
    const next = put(asked, patch);
    config.onAnswer?.(next);
  }

  /** The sale took it: done at once (so a second call tells nothing twice), held again when the terminal could not be told. */
  async function settled(entry: TypedEntry<S>): Promise<void> {
    const saleKey = entry.saleKey ?? entry.unheldFrom?.saleKey ?? null;
    const telling = put(entry, { state: 'done', waitingFor: null, saleKey, unheldFrom: null });
    if (!(await told(config, telling))) put(telling, { state: 'held', waitingFor: 'link' });
  }

  function arrived(deviceId: string, trace: TerminalCaptureTrace): void {
    const known = byCode.get(trace.transactionCode);
    if (known !== undefined) {
      // The terminal did not hear the first acknowledgement: tell it again, book nothing.
      if (known.state === 'done') void told(config, known);
      return;
    }
    const capture = captureWireOf(trace, deviceId);
    const matches = matchTypedCapture(capture, config.dueSales());
    const standalone = allowed();
    const entry: TypedEntry<S> = { deviceId, capture, state: 'asking', matches, standalone, waitingFor: null, saleKey: null, answer: null, unheldFrom: null, flaggedAt: null };
    if (matches.length > 0 || !standalone) put(entry, {});
    else void book(entry);
  }

  /** A capture the policy kept off "on its own": offered again once allowed, booked when nothing matches unless `unhold` put it back or it is flagged. */
  function reask(entry: TypedEntry<S>): void {
    if (!allowed()) return;
    if (current(entry).length === 0 && entry.unheldFrom === null && entry.flaggedAt === null) void book(entry);
    else put(entry, { standalone: true });
  }

  return {
    received: (event) => event.captures.forEach((trace) => arrived(event.deviceId, trace)),
    chooseSale(transactionCode, key) {
      const entry = byCode.get(transactionCode);
      if (entry?.state !== 'asking' || !current(entry).some((sale) => sale.key === key)) return null;
      return put(entry, { state: 'held', saleKey: key, unheldFrom: null }).capture;
    },
    chooseStandalone(transactionCode) {
      const entry = byCode.get(transactionCode);
      if (entry?.state !== 'asking' || !entry.standalone) return false;
      void book(entry, entry.flaggedAt);
      return true;
    },
    bound: (transactionCodes) => among(byCode, transactionCodes, settleable).forEach((entry) => void settled(entry)),
    unhold: (transactionCodes, reason) =>
      among(byCode, transactionCodes, unholdable).forEach((entry) => put(entry, unheldPatch(entry, current(entry), allowed(), reason))),
    retry() {
      [...byCode.values()].forEach((entry) => {
        if (entry.state === 'waiting') void book(entry);
        else if (entry.state === 'held' && entry.waitingFor === 'link') void settled(entry);
        else if (policyHeld(entry)) reask(entry);
      });
    },
    entries: () => [...byCode.values()].map((entry) => (entry.state === 'asking' ? { ...entry, matches: current(entry) } : entry)),
    unanswered: () => [...byCode.values()].filter((entry) => entry.state === 'asking' || entry.state === 'held'),
    subscribe,
  };
}
