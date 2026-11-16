import { rgb, type Color } from 'pdf-lib';
import type { ChartSemanticColor } from '@12-apps/ui/charts';

/**
 * The page's palette: the LIGHT values of `@12-apps/ui`'s theme tokens
 * (`tokens/theme.ts`: the platform seeds and MUI's semantic defaults), because
 * paper is white. A chart series asks for a semantic colour, never a hex, and
 * lands on the same accent the screen draws it in.
 */
function hex(value: string): Color {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const ACCENTS: Record<ChartSemanticColor, string> = {
  primary: '#6366F1',
  secondary: '#8B5CF6',
  success: '#2e7d32',
  warning: '#ed6c02',
  info: '#0288d1',
  danger: '#d32f2f',
  neutral: '#616161',
};

export function accent(token: ChartSemanticColor): Color {
  return hex(ACCENTS[token]);
}

export const DEFAULT_CHART_SCHEME: readonly ChartSemanticColor[] = [
  'primary',
  'secondary',
  'success',
  'warning',
  'danger',
  'info',
];

export const INK = hex('#212121');
export const INK_MUTED = hex('#616161');
export const RULE = hex('#E0E0E0');
export const GRID = hex('#EEEEEE');
export const CARD = hex('#F5F5F7');
export const ZEBRA = hex('#FAFAFA');
export const FLAGGED = hex('#FFF3E0');
export const WARNING = hex('#ed6c02');
export const WHITE = hex('#FFFFFF');
