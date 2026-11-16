/**
 * Measuring the text a heat map would draw (FUT-4063), so the dense step is
 * taken only when its figures really fit and a thinned label row only when its
 * labels really would touch.
 *
 * It asks a canvas 2D context for the width in the cell's own font (read from
 * the table's computed style, so the app's stack and Inter each get their own
 * answer). The figures are drawn with `tabular-nums`, which a canvas does not
 * apply: every digit is measured as the widest digit of the font, which is the
 * width a tabular figure takes. Without a canvas (a test DOM, SSR) an estimate
 * stands in, on the generous side.
 */

/** Width in px of `text` at a size and weight. */
export type TextMeasure = (text: string, px: number, weight: number) => number;

const DIGITS = '0123456789';
/** The canvas font shorthand is a CSS string: its size unit is part of the grammar, not a layout length. */
const PX = 'px';
// The estimate's per-character widths, in em, for a bold figure.
const ESTIMATE_DIGIT_EM = 0.62;
const ESTIMATE_OTHER_EM = 0.6;

function estimate(text: string, px: number): number {
  let em = 0;
  for (const char of text) em += DIGITS.includes(char) ? ESTIMATE_DIGIT_EM : ESTIMATE_OTHER_EM;
  return em * px;
}

let sharedCanvas: HTMLCanvasElement | undefined;

/** The 2D context, or null where there is no canvas (a test DOM, SSR). */
function canvasContext(): CanvasRenderingContext2D | null {
  try {
    if (typeof document === 'undefined') return null;
    sharedCanvas ??= document.createElement('canvas');
    return sharedCanvas.getContext('2d');
  } catch {
    return null;
  }
}

/** A measure in the font family the element draws with. */
export function createTextMeasure(element: Element | null): TextMeasure {
  const family = (element ? getComputedStyle(element).fontFamily : '') || 'sans-serif';
  const widestDigit = new Map<string, number>();
  return (text, px, weight) => {
    const context = canvasContext();
    if (!context) return estimate(text, px);
    const font = [weight, `${px}${PX}`, family].join(' ');
    context.font = font;
    if (!widestDigit.has(font)) {
      widestDigit.set(font, Math.max(...[...DIGITS].map((digit) => context.measureText(digit).width)));
    }
    const widest = widestDigit.get(font) ?? 0;
    const width = [...text].reduce(
      (sum, char) => sum + (DIGITS.includes(char) ? widest : context.measureText(char).width),
      0,
    );
    return Number.isFinite(width) ? width : estimate(text, px);
  };
}

/** The widest text of a list, in px (0 for none). */
export function widestText(texts: readonly string[], measure: TextMeasure, px: number, weight: number): number {
  return texts.reduce((widest, text) => Math.max(widest, measure(text, px, weight)), 0);
}
