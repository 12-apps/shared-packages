/**
 * What a tier ADDS over the one before it — the short list a card shows.
 *
 * A pricing card's job is to answer "why would I move up", and the answer is
 * the DIFFERENCE between two tiers, never the whole catalog. Printing every
 * line on every card said the same thirty labels four times and buried the
 * price and the button under all of them; the full matrix now lives in the
 * comparison table, and each card carries only its own delta.
 *
 * Pure and host-agnostic. It reads the payload the host already sends — the
 * `sections` this package renders — and never invents, reorders or rewords a
 * line: the words stay the host's, and what happens here is set arithmetic
 * over them. Nothing about pricing, currency or product is decided.
 *
 * The tiers arrive cheapest-first (the host's `comparison` builder is ordered),
 * so "the one before it" is the previous entry. A tier at index 0 has no
 * predecessor and every included line is new by definition.
 */
import type { ComparisonLine, ComparisonTier } from '../plan-wire';

/**
 * Why a line is worth showing on this card.
 *
 * The distinction is load-bearing for ORDER, not for wording: a capability
 * the cheaper tier did not have at all is a stronger reason to move up than
 * the same capability with a bigger number, so `added` lines sort ahead of
 * `raised` ones. Without that, the TOP tier's card led with three ceiling
 * bumps and cut the capabilities only it has — its entire reason to exist —
 * off the bottom of a four-line list.
 */
type HighlightKind = 'added' | 'raised';

export interface TierHighlights {
  /** The lines to print, already ordered and trimmed to `limit`. */
  lines: ComparisonLine[];
  /** How many further lines this tier includes but the card does not show. */
  more: number;
  /**
   * The tier this card builds on, or null for the entry tier. The COMMERCIAL
   * name, straight from the payload — a key must never face a customer.
   */
  inheritsFrom: string | null;
}

/**
 * A line's identity across tiers.
 *
 * Section title AND label, because a label is only unique within its section
 * — the host is free to have the same row heading under two sections, and
 * matching on the label alone would silently compare unrelated rows. Encoded
 * as a JSON pair rather than joined on a separator, so no label that happens
 * to contain the separator can collide with a different pair.
 */
function lineKey(sectionTitle: string, label: string): string {
  return JSON.stringify([sectionTitle, label]);
}

/**
 * A tier's whole matrix as one flat sequence of keyed lines.
 *
 * Flattened rather than walked as sections-then-lines because the traversal is
 * a flat one in substance — the total work is linear in the number of lines —
 * and writing it as a nested loop says "join" to every reader and to the
 * complexity gate alike.
 */
function flatLines(tier: ComparisonTier): { key: string; line: ComparisonLine }[] {
  return tier.sections.flatMap((section) =>
    section.lines.map((line) => ({ key: lineKey(section.title, line.label), line })),
  );
}

function linesOf(tier: ComparisonTier): Map<string, ComparisonLine> {
  return new Map(flatLines(tier).map(({ key, line }) => [key, line]));
}

/**
 * Whether `line` is new, better, or the same as the cheaper tier's.
 *
 * A missing counterpart counts as `added` rather than throwing: the two tiers
 * are the host's to shape, and a card that rendered nothing because one
 * section gained a row would be a worse failure than a slightly generous
 * highlight.
 */
function kindOf(line: ComparisonLine, previous: ComparisonLine | undefined): HighlightKind | null {
  if (!line.included) return null;
  if (previous === undefined || !previous.included) return 'added';
  // Same capability, bigger ceiling — "até 100" against "até 20". `detail` is
  // the host's own wording for the value, so comparing the strings compares
  // exactly what the customer would read.
  return line.detail === previous.detail ? null : 'raised';
}

/**
 * The card's list for `tier`, given the whole ordered comparison.
 *
 * `limit` is how many lines the card has room for; everything past it is
 * reported as a count so the card can say the list is trimmed rather than
 * pretending it is complete.
 */
export function tierHighlights(
  tiers: ComparisonTier[],
  index: number,
  limit: number,
): TierHighlights {
  const tier = tiers[index];
  if (tier === undefined) return { lines: [], more: 0, inheritsFrom: null };

  const previous = index > 0 ? tiers[index - 1] : undefined;
  const previousLines = previous === undefined ? new Map<string, ComparisonLine>() : linesOf(previous);

  const added: ComparisonLine[] = [];
  const raised: ComparisonLine[] = [];
  for (const { key, line } of flatLines(tier)) {
    const kind = kindOf(line, previousLines.get(key));
    if (kind === 'added') added.push(line);
    else if (kind === 'raised') raised.push(line);
  }

  const ordered = [...added, ...raised];
  return {
    lines: ordered.slice(0, limit),
    more: Math.max(0, ordered.length - limit),
    inheritsFrom: previous?.name ?? null,
  };
}
