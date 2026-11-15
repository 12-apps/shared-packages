import type { TerminalEvent, TerminalPort } from './port';

/**
 * Which charges this page answers for, per terminal port — so an approval
 * nobody is waiting for is said ONCE, by whoever owns it: the run that pushed
 * the charge while its screen is open (it may take the approval as its leg's),
 * and the host's link indicator otherwise.
 *
 * - **held**: pushed by an open run. The run decides.
 * - **watched**: charges this page answers for that no run waits on: a run's
 *   charges once its screen closed (live or superseded), a pending charge
 *   cancelled from the indicator, and a charge the station still held when
 *   this page loaded (a reload left it). An approval for one is money taken
 *   for no sale: the indicator warns, and the server lists it as unclaimed.
 * - **taken**: transaction codes this page put into a sale, so a resend of the
 *   same approval never reads as a stray.
 *
 * Scoped to the page on purpose: another window's charges are not this
 * page's to warn about. No card data: ids and codes only.
 */

const held = new WeakMap<TerminalPort, Set<string>>();
const watched = new WeakMap<TerminalPort, Set<string>>();
const taken = new WeakMap<TerminalPort, Set<string>>();

function setOf(map: WeakMap<TerminalPort, Set<string>>, port: TerminalPort): Set<string> {
  let found = map.get(port);
  if (found === undefined) {
    found = new Set();
    map.set(port, found);
  }
  return found;
}

export function holdCharge(port: TerminalPort, chargeId: string): void {
  setOf(held, port).add(chargeId);
}

/** The run is gone: its charges are no longer its to decide; the chip watches them. */
export function releaseCharges(port: TerminalPort, chargeIds: Iterable<string>): void {
  const own = held.get(port);
  for (const chargeId of chargeIds) {
    own?.delete(chargeId);
    setOf(watched, port).add(chargeId);
  }
}

/** Charges the station held when this page first read it, or that the chip cancelled: the chip watches them. */
export function watchCharges(port: TerminalPort, chargeIds: Iterable<string>): void {
  for (const chargeId of chargeIds) if (!(held.get(port)?.has(chargeId) ?? false)) setOf(watched, port).add(chargeId);
}

/** Captures this page put into a sale. */
export function noteTaken(port: TerminalPort, codes: Iterable<string>): void {
  for (const code of codes) setOf(taken, port).add(code);
}

type ChargeStatus = Extract<TerminalEvent, { kind: "status" | "orphan-capture" }>;

/** Ended there — approved, cancelled, moved to cash. A decline stays pending: the terminal may retry it. */
function endedThere(event: ChargeStatus): boolean {
  if (event.state === "method_changed") return (event.method ?? "CASH") === "CASH";
  return event.state === "approved" || event.state === "cancelled";
}

/** The watched charges of this port that no open run holds, when `event` names one. */
function watchedFor(port: TerminalPort, chargeId: string): Set<string> | null {
  if (held.get(port)?.has(chargeId) ?? false) return null;
  const mine = watched.get(port);
  return mine !== undefined && mine.has(chargeId) ? mine : null;
}

/**
 * The amount of an approval no open run of this page holds, for a charge this
 * page answers for — or `null` for anything else.
 */
export function strayApproval(port: TerminalPort, event: TerminalEvent): number | null {
  if (event.kind !== "status" && event.kind !== "orphan-capture") return null;
  const mine = watchedFor(port, event.chargeId);
  if (mine === null) return null;
  if (endedThere(event)) mine.delete(event.chargeId);
  if (event.state !== "approved" || !event.capture) return null;
  return taken.get(port)?.has(event.capture.transactionCode) ? null : event.capture.amountCents;
}
