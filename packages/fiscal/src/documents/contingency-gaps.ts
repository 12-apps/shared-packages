/**
 * Which numbers of a contingency block are KNOWN unused and which are
 * UNKNOWN — pure, from the block's state (FUT-4717). A holder signs its block
 * in order and hands its notes in, in order, so:
 *
 * - below the highest number it handed in, a number with no document was
 *   never signed: KNOWN;
 * - a CLOSED block's numbers above what the holder said it used are KNOWN;
 *   between the highest handed in and `usedUpTo` they were signed and are
 *   still to come: UNKNOWN until they arrive;
 * - an ABANDONED block (its holder is gone) above the highest handed in may
 *   be on paper a buyer holds: UNKNOWN, flagged, never voided;
 * - an OPEN block above the highest handed in is still in use: neither.
 *
 * A range already voided is neither.
 */

import type { ContingencyBlockState, ContingencyGap, NumberRange } from "./ports";

/** Consecutive numbers as ranges, ascending. */
function rangesOf(numbers: readonly number[]): NumberRange[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges: NumberRange[] = [];
  for (const number of sorted) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && last.to === number - 1) ranges[ranges.length - 1] = { from: last.from, to: number };
    else ranges.push({ from: number, to: number });
  }
  return ranges;
}

function between(from: number, to: number, keep: (n: number) => boolean): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += 1) if (keep(n)) out.push(n);
  return out;
}

/** The highest number of the block a document was recorded on (`from - 1`: none). */
function highestRecorded(block: ContingencyBlockState): number {
  const inside = block.documented.filter((n) => n >= block.from && n <= block.to);
  return inside.length === 0 ? block.from - 1 : Math.max(...inside);
}

export interface BlockAccount {
  readonly known: NumberRange[];
  readonly unknown: NumberRange[];
}

/** The block's known and unknown ranges (see the module doc). */
export function accountFor(block: ContingencyBlockState): BlockAccount {
  const documented = new Set(block.documented);
  const voided = (n: number) => block.voided.some((range) => n >= range.from && n <= range.to);
  const open = (n: number) => !documented.has(n) && !voided(n);
  const highest = highestRecorded(block);
  const known = between(block.from, highest, open);
  let unknown: number[] = [];
  if (block.fate === "CLOSED") {
    const used = Math.max(highest, block.usedUpTo ?? block.from - 1);
    known.push(...between(used + 1, block.to, open));
    unknown = between(highest + 1, used, open);
  } else if (block.fate === "ABANDONED") {
    unknown = between(highest + 1, block.to, open);
  }
  return { known: rangesOf(known), unknown: rangesOf(unknown) };
}

/** A range of a block, as the gap the service reports. */
export function gapOf(block: ContingencyBlockState, range: NumberRange): ContingencyGap {
  return {
    blockId: block.id,
    ownerId: block.ownerId,
    issuingPointId: block.issuingPointId,
    issuerCnpj: block.issuerCnpj,
    environment: block.environment,
    series: block.series,
    holder: block.holder,
    reservedAt: block.reservedAt,
    from: range.from,
    to: range.to,
  };
}

/** Whether every number is a document or voided, with nothing left to come: the block needs no more work. */
export function isSettled(block: ContingencyBlockState): boolean {
  if (block.fate === "OPEN") return false;
  const { known, unknown } = accountFor(block);
  return known.length === 0 && unknown.length === 0;
}
