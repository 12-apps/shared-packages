import { decomposeColor } from '@mui/material/styles/index.js';

/**
 * Turning ONE brand colour into the mark's fill.
 *
 * The alternative — a second "highlight" prop — reads reasonable and is a trap:
 * it asks every caller to pick a colour that pairs with a colour they already
 * picked, and a multi-tenant app asks that of people who will never see this
 * component. Most would leave it unset, some would set it to the same value
 * (a gradient that is a flat fill), and the rest would get a pairing nobody
 * checked. So the highlight is DERIVED, and a store configures one hex.
 *
 * The derivation moves the seed's HUE rather than only its lightness. A
 * lighten-only gradient reads as a lit sphere — the same effect at every seed,
 * and a weak one at the light end where there is little room left to lighten.
 * Rotating toward the warm side gives the mark a direction the eye follows, and
 * because the rotation is fixed the two stops stay recognisably one colour.
 */

/** Degrees the highlight is rotated from the seed. Warm, and short of a clash. */
const HIGHLIGHT_HUE_SHIFT = 42;

/** The highlight sits this much lighter than the seed. */
const HIGHLIGHT_LIGHTEN = 0.12;

/**
 * A near-grey seed has no hue to rotate, so rotating it produces the same grey
 * twice. Below this saturation the mark falls back to a lightness-only ramp,
 * which is the honest rendering of "this brand has no colour".
 */
const HUELESS = 0.08;

/** The angle light appears to come from — matches the house elevation. */
const GRADIENT_ANGLE = '135deg';

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** `[r, g, b]` in 0–255 from any CSS colour MUI can parse, or `null`. */
function toRgb(color: string): [number, number, number] | null {
  try {
    const { values } = decomposeColor(color);
    const [r, g, b] = values;
    if (r === undefined || g === undefined || b === undefined) return null;
    return [r, g, b];
  } catch {
    // A CSS variable, a colour name MUI does not know, a typo in a tenant's
    // config. The caller falls back to the theme rather than painting nothing.
    return null;
  }
}

function rgbToHsl([r255, g255, b255]: [number, number, number]): Hsl {
  const [r, g, b] = [r255 / 255, g255 / 255, b255 / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  return { h: hueOf(r, g, b, max, delta), s, l };
}

/** Split out so {@link rgbToHsl} stays inside the complexity bar. */
function hueOf(r: number, g: number, b: number, max: number, delta: number): number {
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  return (h + 360) % 360;
}

function hslToHex({ h, s, l }: Hsl): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * The seed's companion stop: rotated toward the warm side and lightened, or —
 * for a seed with no hue worth rotating — lightened alone.
 */
export function highlightOf(seed: string): string {
  const rgb = toRgb(seed);
  if (!rgb) return seed;
  const { h, s, l } = rgbToHsl(rgb);
  const lightened = clamp01(l + HIGHLIGHT_LIGHTEN);
  if (s < HUELESS) return hslToHex({ h, s, l: lightened });
  return hslToHex({ h: (h + HIGHLIGHT_HUE_SHIFT) % 360, s, l: lightened });
}

/** The mark's fill: the seed, running into its derived highlight. */
export function brandGradient(seed: string): string {
  return `linear-gradient(${GRADIENT_ANGLE}, ${seed} 0%, ${highlightOf(seed)} 100%)`;
}

/**
 * Up to two initials for `name`, or `·` when there is nothing to take.
 *
 * First + last rather than first two: "Future Drink" is FD, and a one-word name
 * still yields its single letter instead of a pair that reads as two words.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return '·';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
