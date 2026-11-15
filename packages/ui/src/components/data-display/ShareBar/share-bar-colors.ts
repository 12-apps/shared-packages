import type { Theme } from '@mui/material/styles/index.js';

/**
 * The share bar's default fills (FUT-145): roles, and never `primary` or
 * `error` — a brand that is red would paint one part as a fault. Repeats past
 * its length; a host with more parts passes its own `color` per segment.
 */
export function shareBarPalette(theme: Theme): string[] {
  return [
    theme.palette.info.main,
    theme.palette.secondary.main,
    theme.palette.warning.main,
    theme.palette.success.main,
    theme.palette.info.dark,
    theme.palette.grey[500] ?? theme.palette.text.secondary,
  ];
}
