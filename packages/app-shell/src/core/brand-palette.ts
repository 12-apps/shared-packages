/**
 * Turning a colour a tenant owner TYPED into one the app can safely PAINT.
 *
 * The white-label fields take two free hexes, and a free hex is a loaded gun: a
 * brand's colour is chosen to look good on a can, a sign or a logo, not to be
 * legible as 14px text on a white card. One real seeded tenant is the proof —
 * `#7ED957` renders the price at a contrast ratio of **1.76:1** against the card
 * it sits on, where the readability floor is 4.5:1. Nothing in the product
 * refused that colour, and nothing told the owner. It simply shipped a page
 * whose prices are hard to read, which is the one number on it a buyer must be
 * able to read.
 *
 * So the seed is treated as an INTENT, not as a literal instruction:
 *
 *   - Its HUE is the brand and is never touched. A green tenant stays green.
 *   - Its LIGHTNESS is ours to move, because lightness is what decides
 *     legibility and the owner was not choosing it for that.
 *
 * The result is a colour the owner recognises as theirs, in a tone that cannot
 * be unreadable — and, crucially, one they cannot get wrong by trying. There is
 * no 'you picked a bad colour' error to write, because there is no bad colour.
 *
 * WCAG 2.1 contrast is the arbiter rather than a designer's taste: it is a
 * published, testable number, so 'is this readable' has an answer a unit test
 * can assert instead of an opinion a reviewer has to hold.
 */

type Rgb = readonly [number, number, number];

/** `#RRGGBB` only — the one form the branding API stores. */
const HEX = /^#[0-9a-fA-F]{6}$/u;

/** WCAG 2.1 AA for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

/** The surface a light-mode page body and its cards are painted on. */
export const DEFAULT_SURFACE = '#FFFFFF';

/** How finely the lightness axis is walked. 1% is below the JND for a hue. */
const LIGHTNESS_STEP = 0.01;

function toRgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ] as const;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** sRGB channel → linear light (the WCAG transfer function). */
function linearize(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
}

/**
 * WCAG 2.1 contrast between two `#RRGGBB` colours, 1 (identical) to 21
 * (black on white). Exported because it is the thing worth ASSERTING: a test
 * that pins a hex would pass on a colour nobody can read.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(toRgb(a));
  const lb = luminance(toRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  const h = hueOf(r, g, b, max, delta);
  return { h, s, l };
}

/** Split out so `rgbToHsl` stays inside the complexity gate. */
function hueOf(r: number, g: number, b: number, max: number, delta: number): number {
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  return (h + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))));
  };
  return toHex([channel(0), channel(8), channel(4)]);
}

/** The seed if it is a colour we can work with, else `null`. */
export function brandHex(value: string | null | undefined): string | null {
  return typeof value === 'string' && HEX.test(value) ? value : null;
}

/**
 * The seed's HUE at a lightness and saturation WE choose.
 *
 * This is the answer to the surface tints, and it exists because the obvious
 * alternative is wrong in a way that is easy to miss: painting a band with
 * `alpha(brand, 0.06)` looks like it normalises the colour, but alpha only
 * blends toward the page — it carries the seed's own lightness straight
 * through. Six percent of a pale lime lands on a grey nobody would call green;
 * six percent of a deep navy lands on a tint you cannot miss. Same code, same
 * number, wildly different weight, decided entirely by a colour the owner chose
 * for a logo.
 *
 * Setting the lightness outright removes that variable. Every tenant's band gets
 * the same presence, in its own hue.
 *
 * Saturation is CLAMPED rather than set: a tenant that picked a muted colour
 * keeps a muted tint (forcing it up would invent a vividness they did not ask
 * for), while a neon one is pulled back off the ceiling. A seed with no
 * saturation at all — a grey, a black — stays grey, because a hueless colour has
 * no hue to tint with and a fabricated one would be a colour the tenant never
 * chose.
 */
export function brandTone(
  seed: string,
  lightness: number,
  saturation: readonly [number, number],
): string {
  const hex = brandHex(seed);
  if (!hex) return seed;
  const { h, s } = rgbToHsl(toRgb(hex));
  if (s === 0) return hslToHex(h, 0, lightness);
  return hslToHex(h, Math.min(Math.max(s, saturation[0]), saturation[1]), lightness);
}

/** Saturation band for surfaces: enough hue to read as the brand, never neon. */
export const SURFACE_SATURATION = [0.25, 0.6] as const;

/** A section band's fill — present enough to group, quiet enough to sit under cards. */
export const TINT_LIGHTNESS = 0.955;

/** The same band's edge: one step down, so the border reads as the tint's own. */
export const EDGE_LIGHTNESS = 0.86;

/**
 * The seed, in the lightest tone of its own hue that is still legible AS TEXT
 * on `surface`.
 *
 * 'Lightest that still works' rather than 'darkest that is safe': the walk stops
 * at the first tone clearing the floor, so a colour is moved the minimum
 * distance from what the owner chose. A tenant's near-black navy is returned
 * completely untouched (it already clears 17:1); a bright lime is walked down
 * until it clears, and no further.
 *
 * Hue and saturation are carried through every step, so the answer is always
 * recognisably the SAME colour — a darker green, never a different one.
 *
 * Walks away from the surface in whichever direction that is, so this keeps
 * working in dark mode as well as light: on white it darkens, on near-black it
 * lightens.
 */
export function readableInk(
  seed: string,
  surface: string = DEFAULT_SURFACE,
  min: number = MIN_TEXT_CONTRAST,
): string {
  const hex = brandHex(seed);
  if (!hex) return seed;
  if (contrastRatio(hex, surface) >= min) return hex;

  const { h, s, l } = rgbToHsl(toRgb(hex));
  const darken = luminance(toRgb(surface)) > 0.5;
  // The `??` arm is unreachable for any real surface — pure black clears 21:1 on
  // white and pure white clears it on black — but a caller must never be handed
  // an `undefined` colour.
  return walkToContrast({ h, s, l }, darken, surface, min) ?? (darken ? '#000000' : '#FFFFFF');
}

/**
 * How close a semantic hue may sit to the tenant's brand before it is moved, and
 * how far it moves. Both in degrees on the colour wheel.
 *
 * 26° is about where two hues stop being told apart at a glance on a small
 * control — near enough that a red-branded tenant's 'Remover' button and its
 * 'Adicionar' button read as the same colour. 34° is the smallest shift that
 * clears that band with margin while still landing inside the same colour
 * family: a rotated danger red is an orange-red, not an orange.
 */
export const SEMANTIC_HUE_GUARD = 26;
export const SEMANTIC_HUE_SHIFT = 34;

/** The shorter way round the wheel between two hues, 0–180. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** A hex's hue in degrees, or `null` for a grey (which has no hue to compare). */
export function hueOfHex(value: string): number | null {
  const hex = brandHex(value);
  if (!hex) return null;
  const { h, s } = rgbToHsl(toRgb(hex));
  return s === 0 ? null : h;
}

/**
 * Keep a SEMANTIC colour distinguishable from the tenant's brand (rule 10 of
 * the palette rules stated at the top of this file).
 *
 * The four semantics — success, warning, danger, info — are anchored to meaning,
 * not to the tenant. Green is good and red is stop in every tenant, so nothing
 * here derives them from the brand: that is rule 9, and it is satisfied by
 * simply never computing them from the seed.
 *
 * Anchoring alone is not enough, though, and the failure is specific. A tenant
 * whose brand IS red gets a primary sitting on top of the danger hue: its
 * 'Remover' and its 'Adicionar' become the same colour, and the one distinction
 * on the screen that must never be missed is the one that disappears. The
 * meaning did not survive being anchored, because the brand moved onto it.
 *
 * So the semantic is rotated AWAY from the brand — the semantic yields, never
 * the brand, because the brand is the thing the owner chose and the semantic is
 * ours. It moves in whichever direction it already differs, so a hue is never
 * carried across the brand to the other side. Lightness and saturation are
 * untouched: the rotated colour has to stay as legible as the one it replaces,
 * and it is still recognisably a red.
 *
 * A greyscale brand collides with nothing and a greyscale semantic has no hue to
 * turn, so both are returned unchanged.
 */
export function separateFromBrand(semantic: string, brandSeed: string | null | undefined): string {
  const brandHue = brandSeed ? hueOfHex(brandSeed) : null;
  const hex = brandHex(semantic);
  if (brandHue === null || !hex) return semantic;
  const { h, s, l } = rgbToHsl(toRgb(hex));
  if (s === 0 || hueGap(h, brandHue) >= SEMANTIC_HUE_GUARD) return semantic;
  // Keep going the way it already leans, rather than picking a side.
  const ahead = (h - brandHue + 360) % 360 < 180;
  return hslToHex((h + (ahead ? SEMANTIC_HUE_SHIFT : -SEMANTIC_HUE_SHIFT) + 360) % 360, s, l);
}

/** Step the lightness away from `surface` until the tone clears `min`. */
function walkToContrast(
  hsl: { h: number; s: number; l: number },
  darken: boolean,
  surface: string,
  min: number,
): string | null {
  const steps = Math.round(1 / LIGHTNESS_STEP);
  for (let step = 1; step <= steps; step += 1) {
    const next = hsl.l + (darken ? -1 : 1) * step * LIGHTNESS_STEP;
    if (next < 0 || next > 1) return null;
    const candidate = hslToHex(hsl.h, hsl.s, next);
    if (contrastRatio(candidate, surface) >= min) return candidate;
  }
  return null;
}
