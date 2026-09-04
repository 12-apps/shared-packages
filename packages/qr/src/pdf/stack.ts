/**
 * Where every line of one sticker sits, and how much is left for the code.
 *
 * Split from `sticker.ts` for the reason that module splits from `layout.ts`:
 * a different job with a different failure mode. That one decides what gets
 * DRAWN, this one decides where — and a mistake here is silent on screen and
 * permanent on vinyl, because the type and the code share one height and
 * whatever one takes the other does not get.
 *
 * Everything is measured baseline to baseline, exactly as `stickerOps` draws
 * it. Two places deciding one layout is how the hint ended up printed over the
 * address (FUT-997); the budget and the positions therefore come from the same
 * arithmetic, in this file, and the drawing function only reads it out.
 */
import { mm } from "./pdf-doc";
import type { QrSticker, StickerSize } from "./sticker";
import { fitLines } from "./text-width";

/** The narrowest a caller-supplied string may be set before it stops being type. */
const MIN_PT = 4;

/**
 * The floor for the two lines this module sets itself — the hint and the
 * address.
 *
 * They are derived from the sticker's height, which on the smallest preset put
 * the hint at 4.76 pt: not small type but a grey line, on the one sentence that
 * tells a shopper what the code is FOR. A caller's own strings may still shrink
 * past this when nothing else fits (that is what `MIN_PT` is), because dropping
 * half a product name is worse than setting it small. Ours cannot: they are
 * short by construction, so a floor costs a fraction of a millimetre of code.
 */
const MIN_DISPLAY_PT = 5;

/**
 * At most two lines each: a third would eat into the code, which is read range.
 *
 * The two strings a CALLER supplies without a length limit go through this —
 * the product name and the address. Everything else on the sticker is ours and
 * bounded, so a size derived from the sticker's height is right for it.
 */
const MAX_LINES = 2;

/** Baseline-to-baseline, as a multiple of the type size. */
export const LEADING = 1.15;

/** How far a baseline sits below the top of its own line, as a multiple of the size. */
const CAP = 0.72;

/** And how far the descenders reach below it — what keeps the last line off the blade. */
const DESCENDER = 0.25;

/**
 * The gaps in the stack, as fractions of the sticker's own HEIGHT.
 *
 * They used to be fixed millimetres, which is the same gutter on a 50 mm shelf
 * label and a 150 mm tent card — and a tent card is three times the height. The
 * result was a composition sized for the smallest preset and then printed on
 * every other one: type crowded under the code at the top, and a quarter of the
 * face empty at the foot. Measured on the honest market's default (100x150 mm):
 * 61 pt of dead space, more than a fifth of the sticker's height, all of it in
 * one band above the address.
 *
 * A fraction of the height keeps the smallest preset exactly where it was —
 * these are the millimetres it already used, expressed against 70 mm — and lets
 * every larger one breathe in proportion.
 */
const GAPS = {
  /** Brand to code. */
  brand: 0.036,
  /** Code to the product name — the largest gap in the stack, and the one join. */
  label: 0.05,
  /** Name to price, and price to hint: two tight pairs that read as one block. */
  price: 0.021,
  hint: 0.021,
  /** Hint to the address, which is a footnote and reads as one by sitting apart. */
  url: 0.05,
} as const;

/** The gaps of {@link GAPS}, in points, for one sticker's height. */
type Gaps = Record<keyof typeof GAPS, number>;

/** The type stacked around the code, laid out, and what it costs vertically. */
interface TypeMetrics {
  brand: number;
  hint: number;
  price: number;
  /** The product name, wrapped and sized to the sticker's width. */
  label: { lines: string[]; size: number };
  /** The address, likewise — two UUIDs do not fit on one 50 mm line. */
  url: { lines: string[]; size: number };
  gaps: Gaps;
  /** What the brand line costs above the code, zero when there is none. */
  above: number;
  /** What everything under the code costs, so the QR can take the rest. */
  below: number;
}

/**
 * Point sizes derived from the sticker's own height, and the two variable-length
 * strings laid out against its WIDTH.
 *
 * Both halves belong here rather than in {@link stickerOps}: the QR takes
 * whatever the type does not, so the code's size is a function of how many
 * lines the name and the address actually needed. Computing the fits in the
 * drawing function and the budget here is how the hint ended up printed over
 * the address — two places deciding one layout.
 */
export function typeMetrics(
  size: StickerSize,
  sticker: QrSticker,
  brandName: string,
  inner: number,
): TypeMetrics {
  const height = mm(size.heightMm);
  const labelPt = Math.max(11, height * 0.06);
  const price = labelPt * 0.78;
  const hint = Math.max(MIN_DISPLAY_PT, labelPt * 0.4);
  const brand = labelPt * 0.44;
  const label = fitLines(sticker.label, inner, labelPt, MIN_PT, MAX_LINES);
  const url = fitLines(
    sticker.url.replace(/^https?:\/\//, ""),
    inner,
    Math.max(MIN_DISPLAY_PT, labelPt * 0.28),
    MIN_PT,
    MAX_LINES,
  );
  const gaps = {
    brand: height * GAPS.brand,
    label: height * GAPS.label,
    price: height * GAPS.price,
    hint: height * GAPS.hint,
    url: height * GAPS.url,
  };
  return {
    brand,
    hint,
    price,
    label,
    url,
    gaps,
    above: brandName ? brand + gaps.brand : 0,
    // Measured baseline to baseline, exactly as the stack is drawn — the code's
    // share is what is left over, so a budget that merely approximates the
    // drawing is a budget that prints the hint over the address.
    below:
      gaps.label +
      label.size * CAP +
      (label.lines.length - 1) * label.size * LEADING +
      (sticker.priceLine ? gaps.price + price : 0) +
      gaps.hint +
      hint +
      gaps.url +
      url.size +
      (url.lines.length - 1) * url.size * LEADING +
      url.size * DESCENDER,
  };
}

/** Where every line of one sticker sits, once the code has taken its share. */
interface Stack {
  /** The code's square, in page coordinates. */
  qr: { x: number; y: number; side: number };
  brandBase: number;
  labelBase: number;
  priceBase: number;
  hintBase: number;
  urlBase: number;
}

/**
 * Solve the vertical stack: the code's side, then every baseline under it.
 *
 * The leftover is split EVENLY above and below rather than left at the foot.
 * The code is capped by the sticker's width as often as by its height — every
 * preset but the smallest, in practice — and on those the height budget simply
 * was not spent, so the whole composition hung from the top margin with the
 * slack pooled in one band above the address.
 *
 * Splitting it also buys the thing a pinned address could not: the last line
 * now clears the trim by the same padding as the sides, rather than by the 60%
 * of it the old foot allowed.
 */
export function solveStack(
  sticker: QrSticker,
  x: number,
  y: number,
  geometry: { width: number; height: number; pad: number; inner: number },
  type: TypeMetrics,
): Stack {
  const { width, height, pad, inner } = geometry;
  const available = height - pad * 2;
  const side = Math.min(inner, available - type.above - type.below);
  const slack = Math.max(0, available - type.above - type.below - side);
  const top = y + height - pad - slack / 2;

  const qrTop = top - type.above;
  const { label, url, gaps } = type;
  const labelBase = qrTop - side - gaps.label - label.size * CAP;
  // Everything under the name starts below the LAST of its lines.
  const labelFoot = labelBase - (label.lines.length - 1) * label.size * LEADING;
  const priceBase = labelFoot - gaps.price - type.price;
  const hintBase = (sticker.priceLine ? priceBase : labelFoot) - gaps.hint - type.hint;
  return {
    qr: { x: x + (width - side) / 2, y: qrTop - side, side },
    brandBase: top - type.brand * CAP,
    labelBase,
    priceBase,
    hintBase,
    urlBase: hintBase - gaps.url - url.size,
  };
}
