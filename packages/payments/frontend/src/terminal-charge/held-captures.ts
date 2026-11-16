import type { ChargedLeg, ChargedSplit } from './flow-types';
import type { CaptureWire } from './port';

/**
 * Money the terminal already took, kept per sale until something accounts for
 * it (FUT-4996 K3, A3), and the captures a station recovers on load (State 3).
 *
 * A "key" is the host's own sale key — whatever names one sale on its screen.
 * A capture held under a key survives clearing the sale: it leaves only by a
 * bind (`bound`), a refund flag (`flagged`) or a move to another sale
 * (`rebound`). Anything else would lose money silently, so it throws.
 *
 * In memory, for one page: a capture nobody binds is still listed by the
 * server (the unclaimed captures) and flagged by its refund rule, so losing
 * this store on a reload never loses the money's trail.
 */

/** A capture held for a sale: the wire its leg carries to the server. */
export type HeldCapture = CaptureWire;

/** Why a held capture may leave its sale: each one accounts for the money. */
export type HeldRelease = 'bound' | 'flagged' | 'rebound';

const RELEASES: ReadonlySet<string> = new Set<HeldRelease>(['bound', 'flagged', 'rebound']);

export interface HeldCaptures {
  /** Keep a capture under a sale's key. One capture is held under one key only. */
  hold(key: string, capture: HeldCapture): void;
  /** What the sale holds, in the order it was taken. */
  heldFor(key: string): HeldCapture[];
  /** Whether the sale holds money: the host keeps its key while it does, whatever its lines. */
  holdsMoney(key: string): boolean;
  /**
   * The sale was emptied: its captures are KEPT, under the same key. Answers
   * whether it still holds money, so the screen can say so.
   */
  saleCleared(key: string): boolean;
  /** A capture accounted for leaves its sale. Any other reason throws. */
  release(key: string, transactionCode: string, reason: HeldRelease): void;
  /** Every capture of a sale accounted for at once (the sale settled with them). Any other reason throws. */
  forget(key: string, reason: HeldRelease): void;
  /** Re-render on any change. */
  subscribe(listener: () => void): () => void;
}

function assertRelease(reason: string): asserts reason is HeldRelease {
  if (!RELEASES.has(reason)) {
    throw new Error(`A held capture leaves its sale only when it is bound, flagged or rebound, not "${reason}".`);
  }
}

export function createHeldCaptures(): HeldCaptures {
  const byKey = new Map<string, HeldCapture[]>();
  const listeners = new Set<() => void>();
  const tell = (): void => [...listeners].forEach((listener) => listener());
  const keyOf = (code: string): string | null => {
    for (const [key, captures] of byKey) if (captures.some((capture) => capture.transactionCode === code)) return key;
    return null;
  };

  return {
    hold(key, capture) {
      const owner = keyOf(capture.transactionCode);
      if (owner === key) return;
      if (owner !== null) throw new Error(`The capture ${capture.transactionCode} is already held for another sale.`);
      byKey.set(key, [...(byKey.get(key) ?? []), capture]);
      tell();
    },
    heldFor: (key) => [...(byKey.get(key) ?? [])],
    holdsMoney: (key) => (byKey.get(key)?.length ?? 0) > 0,
    saleCleared: (key) => (byKey.get(key)?.length ?? 0) > 0,
    release(key, transactionCode, reason) {
      assertRelease(reason);
      const left = (byKey.get(key) ?? []).filter((capture) => capture.transactionCode !== transactionCode);
      if (left.length === 0) byKey.delete(key);
      else byKey.set(key, left);
      tell();
    },
    forget(key, reason) {
      assertRelease(reason);
      byKey.delete(key);
      tell();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function heldCentsOf(held: readonly HeldCapture[]): number {
  return held.reduce((sum, capture) => sum + capture.amountCents, 0);
}

/** The held captures as the legs they settle as: the captured kind, the captured amount, the capture. */
function heldLegs(held: readonly HeldCapture[]): ChargedLeg[] {
  return held.map((capture) => ({ tender: capture.kind, amountCents: capture.amountCents, capture }));
}

/** The split the operator answered for the rest, with the held legs in front. */
export function withHeld(split: ChargedSplit, held: readonly HeldCapture[]): ChargedSplit {
  return held.length === 0 ? split : { legs: [...heldLegs(held), ...split.legs], changeCents: split.changeCents };
}

/**
 * The recovered capture to tick for what is still due (State 3): the one whose
 * amount fits exactly, else the largest not above it. When that one is a code
 * the station holds as a typed capture — another screen's question — nothing
 * is ticked: the operator picks, rather than a second-best being guessed.
 */
export function preselectRecovered(captures: readonly HeldCapture[], dueCents: number, typedCodes: ReadonlySet<string>): string[] {
  const fitting = captures.filter((capture) => capture.amountCents <= dueCents);
  const exact = fitting.find((capture) => capture.amountCents === dueCents);
  const best = exact ?? fitting.reduce<HeldCapture | null>((top, capture) => (top === null || capture.amountCents > top.amountCents ? capture : top), null);
  return best === null || typedCodes.has(best.transactionCode) ? [] : [best.transactionCode];
}

/** How many listed captures have no sale, less the codes the station holds as typed captures. */
export function unclaimedCount(listed: readonly HeldCapture[], typedCodes: ReadonlySet<string>): number {
  return listed.filter((capture) => !typedCodes.has(capture.transactionCode)).length;
}
