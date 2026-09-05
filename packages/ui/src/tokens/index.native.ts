/**
 * `@12-apps/ui/tokens` on React Native: the vocabulary, the type scale, the
 * theme and the colour arithmetic. NOT `accentFor` or `headingMetrics`, which
 * read a MUI `Theme` and belong to the web build — a native component reads
 * `useUiTheme()` from `@12-apps/ui/provider` instead.
 */
export * from './vocabulary';
export * from './theme';
export * from './color';
