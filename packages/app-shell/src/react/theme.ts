import { createTheme, type Theme } from '@12-apps/ui/mui/styles';

import { brandHex, DEFAULT_SURFACE, readableInk, separateFromBrand } from '../core/brand-palette';

/** Supported color-scheme modes for the app theme. */
export type ThemeMode = 'light' | 'dark';

/** A primary/secondary color token pair for a single mode. */
export interface ModeTokens {
  primary: string;
  secondary: string;
}

/**
 * The PLATFORM's own colour tokens, per mode.
 *
 * These are the default, not a rule: a host's design tokens are a host's own, so
 * {@link AppThemeOptions.tokens} replaces them. The defaults are the pair the
 * three SPAs this was extracted from ship, mirrored from `@12-apps/ui`'s Storybook
 * preview — keep them in sync if the design tokens change there.
 */
export const DEFAULT_THEME_TOKENS: Record<ThemeMode, ModeTokens> = {
  light: { primary: '#6366F1', secondary: '#8B5CF6' },
  dark: { primary: '#818CF8', secondary: '#A78BFA' },
};

/**
 * A tenant's palette override. Either color may be absent — a tenant that set
 * only a primary keeps the platform secondary rather than losing it.
 */
export interface PaletteOverride {
  primary?: string | null;
  secondary?: string | null;
}

/**
 * The page a tenant's text is read against, per mode — the DEFAULT, not a rule.
 *
 * Replaceable through {@link AppThemeOptions.surface}, and it has to be: the WCAG
 * correction in `brandRole` is computed against this hex, so a host whose page is a
 * tinted card gets a tenant seed corrected to ≥4.5:1 against a background it does not
 * use — and the guarantee `brandRole` advertises as structural quietly stops holding.
 * The core already parameterizes it (`readableInk(hex, surface, min)`), so hardcoding
 * it here was also a second spelling of a constant that already has an owner: the light
 * value IS `DEFAULT_SURFACE`, imported rather than retyped.
 */
export const DEFAULT_SURFACES: Record<ThemeMode, string> = {
  light: DEFAULT_SURFACE,
  dark: '#121212',
};

/**
 * One palette role, from a tenant seed or the platform token.
 *
 * `main` is the seed CORRECTED to a legible tone, and that choice is what makes
 * the guarantee structural rather than a list of call sites. `main` is the token
 * every consumer reaches for — a text colour, a tab's label and indicator, a
 * chip's outline, a filled button — and the components asking for it cannot know
 * whether they are about to paint text or a background. So correcting the token
 * once fixes all of them at the same instant, and no component added later can
 * reintroduce an unreadable price by doing the ordinary thing.
 *
 * The cost is honest and worth naming: a tenant whose brand is a bright lime gets
 * buttons in a deeper lime than the swatch they picked, because one tone has to
 * serve both jobs. `light` keeps their exact hex for anything that is purely
 * decorative and wants the vivid original.
 *
 * Only OVERRIDES are corrected. The platform's own tokens are design decisions
 * already made, and re-deriving them here would quietly restyle every screen from
 * a function nobody thinks of as owning that.
 */
function brandRole(
  seed: string | null | undefined,
  fallback: string,
  surface: string,
): { main: string; light?: string } {
  const hex = brandHex(seed);
  if (!hex) return { main: fallback };
  return { main: readableInk(hex, surface), light: hex };
}

/** MUI's default semantic hexes, restated so they can be reasoned about. */
const SEMANTIC_ANCHORS = {
  success: '#2e7d32',
  warning: '#ed6c02',
  error: '#d32f2f',
  info: '#0288d1',
} as const;

/**
 * The four meanings, stated rather than inherited — and moved out of the brand's
 * way when it lands on one.
 *
 * These are MUI's own default hexes. Naming them here changes nothing for a
 * platform-coloured app, and that is the point: it makes the invariant explicit
 * and gives `separateFromBrand` something anchored to rotate. Green stays good and
 * red stays stop in every tenant, because none of these is ever computed from the
 * tenant's seed.
 *
 * Only the PRIMARY is guarded against. It is the colour on every button a user
 * actually presses, so it is the one a semantic can be confused with; the
 * secondary appears on far less, and guarding against both would rotate two
 * semantics for a tenant whose two brand colours are merely near each other.
 */
function semantics(primarySeed: string | null | undefined): {
  success: { main: string };
  warning: { main: string };
  error: { main: string };
  info: { main: string };
} {
  const guard = (hex: string): { main: string } => ({
    main: separateFromBrand(hex, primarySeed),
  });
  return {
    success: guard(SEMANTIC_ANCHORS.success),
    warning: guard(SEMANTIC_ANCHORS.warning),
    error: guard(SEMANTIC_ANCHORS.error),
    info: guard(SEMANTIC_ANCHORS.info),
  };
}

/** What {@link createAppTheme} takes beyond the mode. */
export interface AppThemeOptions {
  /** A tenant's white-label seed. Corrected for legibility before it is painted. */
  override?: PaletteOverride | null;
  /** The host's own platform tokens. Defaults to {@link DEFAULT_THEME_TOKENS}. */
  tokens?: Partial<Record<ThemeMode, ModeTokens>>;
  /**
   * The page a tenant's text is actually read against, per mode. Defaults to
   * {@link DEFAULT_SURFACES}.
   *
   * Pass it if your app's background is not white in light mode (or not `#121212` in
   * dark): it is the hex the legibility correction is computed against, so a wrong one
   * lands the tenant's text under the 4.5:1 floor on the surface you really paint.
   */
  surface?: Partial<Record<ThemeMode, string>>;
}

/**
 * Build an MUI theme for the given mode using the shared design tokens.
 *
 * `override` lets a white-labelled host swap the palette while keeping every other
 * token identical — MUI's `augmentColor` derives the remaining shades and
 * `contrastText` from `main`, so a tenant hex needs no extra plumbing beyond the
 * legibility correction in {@link brandRole}.
 */
export function createAppTheme(mode: ThemeMode = 'light', options: AppThemeOptions = {}): Theme {
  const tokens = options.tokens?.[mode] ?? DEFAULT_THEME_TOKENS[mode];
  const surface = options.surface?.[mode] ?? DEFAULT_SURFACES[mode];
  const { override } = options;

  return createTheme({
    palette: {
      mode,
      primary: brandRole(override?.primary, tokens.primary, surface),
      secondary: brandRole(override?.secondary, tokens.secondary, surface),
      ...semantics(override?.primary),
    },
  });
}
