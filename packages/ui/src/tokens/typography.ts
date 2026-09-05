import type { Theme } from '@mui/material/styles/index.js';

import { HEADING_SCALE, type HeadingLevel, type HeadingMetrics, type HeadingScaleOverrides } from './heading-scale';

/**
 * The MUI half of the type scale: the theme augmentation and the reader that
 * merges a host's overrides. The scale itself is in `./heading-scale`, which
 * imports nothing, so `src/tokens/theme.ts` and the native renderer read it
 * without dragging MUI's `Theme` into `dist/types-native`.
 */
export * from './heading-scale';

/**
 * The theme channel, under our OWN key rather than MUI's `typography.h1…h6`.
 *
 * Those are spoken for: MUI ships its own values there (`h1` is 6rem) and
 * `<Typography variant="h1">` renders them. Reading them here would hand an
 * un-themed host a 96px `h1` — worse than the number this change exists to fix —
 * and would make `Heading` and `Typography` impossible to size apart. A separate
 * key means a host that sets nothing gets {@link HEADING_SCALE}, and a host that
 * sets something gets exactly what it asked for.
 */
declare module '@mui/material/styles' {
  interface TypographyVariants {
    headingScale?: HeadingScaleOverrides;
  }
  interface TypographyVariantsOptions {
    headingScale?: HeadingScaleOverrides;
  }
}

/**
 * One step of the scale, with the host's theme layered over the default.
 *
 * Merged PER METRIC, so a host that only wants a different `fontSize` keeps the
 * line height and letter spacing the step was designed with instead of having to
 * restate them — restating is how a partial override silently loses the tracking
 * that made the size readable.
 */
export function headingMetrics(theme: Theme, level: HeadingLevel): HeadingMetrics {
  return { ...HEADING_SCALE[level], ...theme.typography.headingScale?.[level] };
}
