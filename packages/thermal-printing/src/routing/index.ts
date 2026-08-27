/**
 * Which printer takes which order.
 *
 * Pure, and worth its own module for the reason the layout is worth splitting
 * from the encoders: this is the decision most likely to be got subtly wrong,
 * and the wrong version of it prints somebody's work in the wrong room rather
 * than throwing.
 *
 * ## Most of what a host prints has no destination at all
 *
 * A destination here is whatever the host groups printers by — a kitchen
 * section, a floor, a department. Whatever it is, some of what the host prints
 * will not belong to one, and for a host that does not use the grouping at all
 * that is EVERYTHING. Hence the default printer, keyed `null`: without it,
 * per-destination routing silently covers almost nothing.
 */


/**
 * The half of a printer this decision reads.
 *
 * Deliberately three fields and generic over the rest: a host passes its own
 * printer rows straight in and gets its own rows back, with no mapping layer
 * whose only job is to satisfy this signature.
 */
export interface RoutablePrinter {
  id: string;
  /** The destination this printer serves, or `null` for the host-wide default. */
  destinationId: string | null;
  active: boolean;
}

/** Printers indexed by destination — `null` holds the default. */
export type PrinterRoute<T extends RoutablePrinter> = Map<string | null, T>;

/**
 * Index the host's printers by destination.
 *
 * **Inactive printers stay in the map**, and that is the whole subtlety of this
 * module. "This destination has no printer" and "this destination's printer is
 * switched off tonight" are different facts with different answers, and only a
 * map that holds both can tell them apart — see {@link printerFor}.
 */
export function printerRoute<T extends RoutablePrinter>(printers: readonly T[]): PrinterRoute<T> {
  return new Map(printers.map((printer) => [printer.destinationId, printer]));
}

/**
 * The printer for `destinationId`, or `null` when nothing prints it.
 *
 * A destination that OWNS a printer is answered by that printer and never by
 * another one — so switching one room's printer off means that room's tickets
 * stop, NOT that they quietly start coming out somewhere else. Relocating a
 * section's work to another room is a surprise nobody asked for, and the
 * likeliest way for it to end is a ticket nobody in that room ever sees.
 *
 * A destination with no printer of its own falls to the default, which is what
 * makes a one-printer site work at all.
 *
 * `null` is a normal answer rather than a failure: a host that has configured
 * one destination's printer and no default genuinely does not print the rest,
 * and the honest response is to say so rather than print it somewhere
 * arbitrary.
 */
export function printerFor<T extends RoutablePrinter>(
  route: PrinterRoute<T>,
  destinationId: string | null,
): T | null {
  const own = destinationId === null ? undefined : route.get(destinationId);
  // A destination's own printer claims it whether or not it is switched on.
  if (own !== undefined) return own.active ? own : null;
  const fallback = route.get(null);
  return fallback !== undefined && fallback.active ? fallback : null;
}
