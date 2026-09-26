/**
 * `@12-apps/ui/tokens` on React Native: the vocabulary, the type scale, the
 * theme and the colour arithmetic. NOT `accentFor` or `headingMetrics`, which
 * read a MUI `Theme` and belong to the web build — a native component reads
 * `useUiTheme()` from `@12-apps/ui/provider` instead.
 */
export * from './vocabulary';
export * from './theme';
export * from './color';
export { DEFAULT_FIELD_RADIUS } from './field-radius.core';
export {
  DEFAULT_FIELD_HEIGHT,
  FIELD_BORDER_WIDTH,
  FIELD_HEIGHT_SCALE,
  fieldHeightPx,
  fieldHeightRem,
} from './field-height.core';
// The density knob's factor table and resolver (FUT-2764); `DensityLevel`/
// `ResolvedDensity` are already exported above, through `./theme`. NOT
// `useDensity`, which reads a MUI theme and belongs to the web build.
export {
  DEFAULT_DENSITY,
  DENSITY_FACTOR,
  densityFieldHeight,
  densityFontSize,
  densitySpacingUnit,
  resolveDensityFactor,
} from './density.core';
// The named colour sets a *.metrics.ts table reads (FUT-2593); no MUI behind them.
export * from './ink.core';
