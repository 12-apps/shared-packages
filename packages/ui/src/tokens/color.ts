/**
 * COLOUR ARITHMETIC WITH NO RENDERER BEHIND IT.
 *
 * Every shade the web components paint comes out of MUI's colour manipulator:
 * `lighten(main, 0.2)` is a palette's `light`, `darken(main, 0.3)` its `dark`,
 * `alpha(main, 0.1)` the hover wash on an outline button. A native component
 * that wants the SAME pixel has to run the SAME arithmetic, and it cannot
 * import it — `@mui/material/styles` drags emotion and the DOM in behind it.
 *
 * So the arithmetic lives here, once, with nothing behind it. It is a faithful
 * port of `@mui/system/colorManipulator` (MIT), down to the truncation:
 * `lighten('#6366F1', 0.2)` is `rgb(130, 132, 243)` on both sides because both
 * TRUNCATE 132.6 rather than round it. A port that rounded would be one pixel
 * of tint away from the web on every button, forever, and nothing would flag it.
 *
 * `color()` space strings are deliberately unsupported: nothing in this package
 * emits one, and a smaller surface is a smaller thing to keep identical.
 */

export type ColorFormat = 'rgb' | 'rgba' | 'hsl' | 'hsla';

export interface DecomposedColor {
  type: ColorFormat;
  values: number[];
}

const FORMATS: readonly ColorFormat[] = ['rgb', 'rgba', 'hsl', 'hsla'];

const clamp = (value: number, min = 0, max = 1): number => Math.min(Math.max(min, value), max);

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` to its `rgb()` / `rgba()` string. */
export function hexToRgb(color: string): string {
  const hex = color.slice(1);
  const pair = new RegExp(`.{1,${hex.length >= 6 ? 2 : 1}}`, 'g');
  let channels: string[] | null = hex.match(pair);
  if (channels && channels[0]?.length === 1) {
    channels = channels.map((channel) => channel + channel);
  }
  if (!channels) return '';

  const parts = channels.map((channel, index) =>
    index < 3 ? parseInt(channel, 16) : Math.round((parseInt(channel, 16) / 255) * 1000) / 1000,
  );
  return `rgb${channels.length === 4 ? 'a' : ''}(${parts.join(', ')})`;
}

/** Any supported colour string to its type and numeric channels. */
export function decomposeColor(color: string): DecomposedColor {
  if (color.charAt(0) === '#') {
    return decomposeColor(hexToRgb(color));
  }

  const marker = color.indexOf('(');
  const type = color.substring(0, marker) as ColorFormat;
  if (!FORMATS.includes(type)) {
    throw new Error(
      `@12-apps/ui: unsupported colour "${color}". Use #nnn, #nnnnnn, rgb(), rgba(), hsl() or hsla().`,
    );
  }

  const values = color
    .substring(marker + 1, color.length - 1)
    .split(',')
    .map((value) => parseFloat(value));

  return { type, values };
}

/** The inverse of {@link decomposeColor}, with MUI's channel truncation. */
export function recomposeColor({ type, values }: DecomposedColor): string {
  const parts: Array<number | string> = type.startsWith('rgb')
    ? values.map((value, index) => (index < 3 ? Math.trunc(value) : value))
    : [values[0] ?? 0, `${values[1] ?? 0}%`, `${values[2] ?? 0}%`, ...values.slice(3)];

  return `${type}(${parts.join(', ')})`;
}

/** An `hsl()` / `hsla()` string to its `rgb()` / `rgba()` equivalent. */
export function hslToRgb(color: string): string {
  const { type, values } = decomposeColor(color);
  const h = values[0] ?? 0;
  const s = (values[1] ?? 0) / 100;
  const l = (values[2] ?? 0) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number, k = (n + h / 30) % 12): number =>
    l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);

  const rgb = [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  if (type === 'hsla') {
    return recomposeColor({ type: 'rgba', values: [...rgb, values[3] ?? 1] });
  }
  return recomposeColor({ type: 'rgb', values: rgb });
}

/** Relative luminance (WCAG 2.0), to three decimals like MUI. */
export function getLuminance(color: string): number {
  const decomposed = decomposeColor(color);
  const channels = decomposed.type.startsWith('hsl')
    ? decomposeColor(hslToRgb(color)).values
    : decomposed.values;

  const [r, g, b] = channels.slice(0, 3).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return Number((0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)).toFixed(3));
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function getContrastRatio(foreground: string, background: string): number {
  const lumA = getLuminance(foreground);
  const lumB = getLuminance(background);
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

/** The colour with its alpha channel set to `value` (0 to 1). */
export function alpha(color: string, value: number): string {
  const decomposed = decomposeColor(color);
  const type: ColorFormat = decomposed.type.endsWith('a')
    ? decomposed.type
    : (`${decomposed.type}a` as ColorFormat);
  const values = decomposed.values.slice(0, 3);
  values[3] = clamp(value);
  return recomposeColor({ type, values });
}

/** The colour moved `coefficient` (0 to 1) of the way towards black. */
export function darken(color: string, coefficient: number): string {
  const decomposed = decomposeColor(color);
  const amount = clamp(coefficient);
  const values = [...decomposed.values];

  if (decomposed.type.startsWith('hsl')) {
    values[2] = (values[2] ?? 0) * (1 - amount);
  } else {
    for (let index = 0; index < 3; index += 1) {
      values[index] = (values[index] ?? 0) * (1 - amount);
    }
  }
  return recomposeColor({ type: decomposed.type, values });
}

/** The colour moved `coefficient` (0 to 1) of the way towards white. */
export function lighten(color: string, coefficient: number): string {
  const decomposed = decomposeColor(color);
  const amount = clamp(coefficient);
  const values = [...decomposed.values];

  if (decomposed.type.startsWith('hsl')) {
    values[2] = (values[2] ?? 0) + (100 - (values[2] ?? 0)) * amount;
  } else {
    for (let index = 0; index < 3; index += 1) {
      values[index] = (values[index] ?? 0) + (255 - (values[index] ?? 0)) * amount;
    }
  }
  return recomposeColor({ type: decomposed.type, values });
}

/** Darken a light colour or lighten a dark one, by `coefficient`. */
export function emphasize(color: string, coefficient = 0.15): string {
  return getLuminance(color) > 0.5 ? darken(color, coefficient) : lighten(color, coefficient);
}
