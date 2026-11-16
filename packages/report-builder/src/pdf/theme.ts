import { rgb, type Color } from 'pdf-lib';
import { createUiTheme, type UiTheme } from '@12-apps/ui/tokens';
import type { ChartSemanticColor } from '@12-apps/ui/charts';

/**
 * The page's palette, read from `@12-apps/ui`'s theme (the LIGHT one: paper is
 * white), so an accent here is the accent the screen draws and a host's brand
 * flows through the same seeds the screen takes. Nothing is spelled in hex in
 * this package.
 */
export type Tone = 'ink' | 'muted' | 'rule' | 'grid' | 'card' | 'zebra' | 'white';

export interface PdfPalette {
  tones: Record<Tone, Color>;
  accents: Record<ChartSemanticColor, Color>;
}

/** What a host may pass to colour the page: a resolved theme, or just the brand seeds. */
export interface ReportPdfTheme {
  /** A resolved theme (`createUiTheme()`); its palette is used as is. */
  theme?: UiTheme;
  /** The store's brand, when no theme is passed: a hex colour each. */
  brand?: { primary?: string; secondary?: string };
}

const FALLBACK = rgb(0.13, 0.13, 0.13);

/** A `#rgb` or `#rrggbb` colour; anything else (a CSS function, a name) gets `fallback`. */
function toColor(value: string, fallback: Color = FALLBACK): Color {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match?.[1]) return fallback;
  const digits = match[1].length === 3 ? [...match[1]].map((char) => char + char).join('') : match[1];
  const n = Number.parseInt(digits, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function createPdfPalette(options: ReportPdfTheme = {}): PdfPalette {
  const theme =
    options.theme ??
    createUiTheme({
      mode: 'light',
      palette: {
        ...(options.brand?.primary ? { primary: options.brand.primary } : {}),
        ...(options.brand?.secondary ? { secondary: options.brand.secondary } : {}),
      },
    });
  const { palette } = theme;
  const accent = (token: ChartSemanticColor): Color => toColor(palette[token].main);
  return {
    tones: {
      ink: toColor(palette.grey[900]),
      muted: toColor(palette.grey[700]),
      rule: toColor(palette.grey[300]),
      grid: toColor(palette.grey[200]),
      card: toColor(palette.grey[100]),
      zebra: toColor(palette.grey[50]),
      white: rgb(1, 1, 1),
    },
    accents: {
      primary: accent('primary'),
      secondary: accent('secondary'),
      success: accent('success'),
      warning: accent('warning'),
      info: accent('info'),
      danger: accent('danger'),
      neutral: accent('neutral'),
    },
  };
}

export const DEFAULT_CHART_SCHEME: readonly ChartSemanticColor[] = [
  'primary',
  'secondary',
  'success',
  'warning',
  'danger',
  'info',
];
