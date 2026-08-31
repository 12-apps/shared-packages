/**
 * How wide a string actually is in Helvetica.
 *
 * The sticker sets type sizes from the sticker's own height, which is right for
 * everything whose length is bounded — a brand, a hint, a price. It is wrong
 * for the two strings the CALLER supplies without a length limit: the label and
 * the URL. A 24-character product name and a 96-character subproduct URL are
 * both legal, and at a fixed point size the second one runs off a 50 mm sticker
 * and across the crop marks.
 *
 * Guessing an average character width does not fix that, it moves it: a URL is
 * mostly digits and hex at 556/1000 em, but a hostname of `m`s is 833 and one
 * of `l`s is 222 — a single constant is wrong by a factor of nearly four across
 * the range a real caller can hand over. So this measures.
 *
 * The numbers are Adobe's own Helvetica metrics, per 1000 units of em, for the
 * printable ASCII range. Nothing here needs the AFM at runtime: the font is one
 * of the fourteen a PDF reader is required to have, which is exactly why the
 * builder embeds no font file, and its widths are therefore fixed forever.
 *
 * Non-ASCII is not in the table and is charged at `FALLBACK`. That direction is
 * deliberate — over-charging shrinks type that would have fit, under-charging
 * puts it off the edge, and only one of those is discovered at the gráfica.
 */

/** Charged for any character the table does not carry. Wider than all but `@`. */
const FALLBACK = 833;

/**
 * Advance widths per 1000 em, ASCII 32..126, in code-point order.
 *
 * A dense array rather than a map: it is indexed arithmetic on the code point,
 * and a 95-entry object literal is a lot of syntax for a lookup table.
 */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const FIRST = 32;

/** The width of `value` set in Helvetica at `size` points. */
export function helveticaWidth(value: string, size: number): number {
  let thousandths = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const index = code - FIRST;
    thousandths += HELVETICA[index] ?? FALLBACK;
  }
  return (thousandths * size) / 1000;
}

/**
 * The pieces a line may be broken between.
 *
 * A product name breaks at spaces — "Heineken Long Neck / 330ml" reads as a
 * name on two lines, where "Heineken Long Neck 3 / 30ml" reads as a mistake.
 * An address has no spaces, so it falls through to characters, which is right:
 * a UUID hyphenated at its own `-` would look like the hyphen was ours.
 */
function piecesOf(value: string): string[] {
  if (!value.includes(" ")) return [...value];
  // The space rides with the word before it, so a break never leaves one
  // dangling at the start of the next line.
  return value.split(/(?<= )/);
}

/**
 * `value` broken into at most `maxLines` lines that each fit `maxWidth`.
 *
 * Anything past `maxLines` is dropped, which is the signal {@link fitLines}
 * shrinks on — this function reports what fits, it does not decide what to do
 * about it. A single piece too wide for the line is emitted anyway: refusing
 * would return nothing at all, and the caller's floor is what bounds it.
 */
export function wrapToWidth(
  value: string,
  maxWidth: number,
  size: number,
  maxLines: number,
): string[] {
  if (helveticaWidth(value, size) <= maxWidth) return [value];

  const lines: string[] = [];
  let line = "";
  for (const piece of piecesOf(value)) {
    const next = line + piece;
    if (helveticaWidth(next, size) > maxWidth && line !== "") {
      lines.push(line);
      line = piece;
      if (lines.length === maxLines) return lines;
    } else {
      line = next;
    }
  }
  if (line !== "" && lines.length < maxLines) lines.push(line);
  return lines;
}

/** How much smaller each attempt gets. Fine enough that the last step is not a jump. */
const STEP_PT = 0.25;

/**
 * `value` laid out whole: wrapped first, shrunk only if wrapping is not enough.
 *
 * The order encodes what these strings are for. Squeezed onto ONE line, a
 * subproduct address — two UUIDs, ~96 characters — lands near 2.5 pt on a 50 mm
 * sticker, which is not small type but a grey smudge; and that line exists
 * precisely so a torn code is still an address somebody can reach. Two legible
 * lines keep the promise that one illegible line abandons.
 *
 * `minimum` is a floor on legibility, not a guarantee of fit: a caller can
 * always hand over a string no sticker can carry. When the floor binds, this
 * returns what fits at the floor and says so through `whole`, so a caller can
 * decide rather than discovering it on paper.
 */
export function fitLines(
  value: string,
  maxWidth: number,
  preferred: number,
  minimum: number,
  maxLines: number,
): { lines: string[]; size: number; whole: boolean } {
  let size = preferred;
  for (;;) {
    const lines = wrapToWidth(value, maxWidth, size, maxLines);
    // Fewer characters back than went in means the wrap hit its line cap. The
    // join is over the pieces as they were split, so a word break's trailing
    // space is still in there and the comparison stays exact.
    const whole = lines.join("") === value;
    if (whole || size <= minimum) return { lines, size, whole };
    size = Math.max(minimum, size - STEP_PT);
  }
}
