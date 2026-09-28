import { createTheme } from '@12-apps/ui/mui/styles';
import type { DensityLevel } from '@12-apps/ui/tokens';

/**
 * The public shape {@link AppThemeOptions} takes, split out of `./theme` for
 * the same reason `./config.ts` gives its own split: this is mostly DOCTRINE
 * (why each key exists, what it defaults to, what it costs to omit), and that
 * prose pushed `./theme.ts` over the complexity gate's 400-line limit. A type
 * module erases completely at build, so moving it costs the emitted bundle
 * nothing. `./theme` re-exports every name here, so the import path an
 * adopter already writes is unchanged.
 */

/**
 * What `createTheme` accepts under `components`, derived from the function
 * rather than imported.
 *
 * `@12-apps/ui/mui/styles` does not re-export `ThemeOptions`, and reaching past it
 * to `@mui/material/styles` would give this module a second route to MUI that
 * the rest of the package deliberately does not have. Deriving it is also the
 * tighter statement: the type is defined as "whatever the factory below takes",
 * so it cannot drift from it.
 */
type ThemeComponents = NonNullable<Parameters<typeof createTheme>[0]>['components'];

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

/** The four meanings, as a host may state them. Any subset. */
export type SemanticTokens = Partial<Record<'success' | 'warning' | 'error' | 'info', string>>;

/** The two grounds MUI paints: the page, and anything raised off it. */
export interface ModeSurfaces {
  /** The page itself. */
  default: string;
  /** A card, a sheet, a menu — anything sitting on the page. */
  paper: string;
}

/** What {@link createAppTheme} takes beyond the mode. */
export interface AppThemeOptions {
  /** A tenant's white-label seed. Corrected for legibility before it is painted. */
  override?: PaletteOverride | null;
  /** The host's own platform tokens. Defaults to {@link DEFAULT_THEME_TOKENS}. */
  tokens?: Partial<Record<ThemeMode, ModeTokens>>;
  /**
   * The page a tenant's text is actually read against, per mode. Defaults to
   * `DEFAULT_SURFACES`.
   *
   * Pass it if your app's background is not white in light mode (or not `#121212` in
   * dark): it is the hex the legibility correction is computed against, so a wrong one
   * lands the tenant's text under the 4.5:1 floor on the surface you really paint.
   */
  surface?: Partial<Record<ThemeMode, string>>;
  /**
   * The grounds this app paints, per mode — the page and anything raised off it.
   *
   * Without this the factory hands MUI a palette with no `background`, so MUI
   * fills in its own neutrals: `#fff` on `#fff` in light, `#121212` on `#1e1e1e`
   * in dark. A host whose page is not one of those had exactly one way out, and
   * it was the wrong one: paint `body` from a `MuiCssBaseline` override and leave
   * `palette.background.default` saying something else. That is not a cosmetic
   * mismatch — `background.default` and `background.paper` are the tokens sticky
   * headers, empty states and scroll shadows read to MATCH the page, so every one
   * of them matches a page the app does not have. The seam stays invisible until
   * one of them lands next to the real ground.
   *
   * Setting it also spares the host the second half of that workaround, which is
   * that `body` is not the only ground: the overscroll gutter and the area behind
   * a short page are the browser's, and they follow `html`, which no palette
   * reaches.
   *
   * Partial per mode, like {@link tokens}: state the mode you actually paint and
   * the other keeps MUI's default rather than inheriting a colour meant for the
   * opposite scheme.
   */
  background?: Partial<Record<ThemeMode, ModeSurfaces>>;
  /**
   * The hairline this app rules with, per mode.
   *
   * Its own key rather than part of {@link background} because it is not a
   * ground — MUI derives `divider` from its neutral greys, so a warm or tinted
   * palette gets a cold line between every table row, list item and card while
   * everything on either side of it is correct. Small, everywhere, and invisible
   * in review precisely because a 1px rule is what nobody looks at.
   */
  divider?: Partial<Record<ThemeMode, string>>;
  /**
   * This app's own four meanings, per mode. Any subset.
   *
   * The defaults are MUI's anchors, which is the right answer for most hosts and
   * is why this is optional. Pass it when the product has DECIDED what danger
   * looks like — a warm palette whose danger must not be the same red as its
   * primary, a design system that owns its own green.
   *
   * A semantic stated here is used verbatim: it is never rotated away from the
   * brand, on the same principle that {@link tokens} are never corrected. The
   * rotation guards the anchors this package supplies, which no host has
   * approved; a hex the host wrote down is a decision, and the factory does not
   * get to move it.
   */
  semantics?: Partial<Record<ThemeMode, SemanticTokens>>;
  /**
   * The host's own MUI component overrides, merged into the theme this builds.
   *
   * REQUIRED to exist, even though it is optional to pass, and the reason is
   * that a theme is not only a palette. A host arrives here with `styleOverrides`
   * and `defaultProps` of its own — a glass treatment on `MuiAlert`, a radius on
   * `MuiButton` — and before this key the only way to keep them was to not use
   * this factory at all. Which is to say: the factory silently encoded "no host
   * needs component overrides", and that was true of exactly the one host it was
   * extracted from.
   *
   * The failure it produced was the quiet kind. Adopting the shell dropped the
   * overrides with no type error and no test failure — the theme is still a valid
   * theme, the app still renders, and the only symptom is that a component stops
   * looking the way the product designed it, everywhere at once.
   *
   * Merged UNDER nothing: these win. The factory owns the palette (that is what
   * the legibility correction is for), and the host owns how its components are
   * drawn.
   */
  components?: ThemeComponents;
  /**
   * The field corner (px) and height (multiples of the default font size).
   * Default 8px and 2.5rem. `@12-apps/ui`'s fields read both; the factory also
   * puts MUI's own outlined fields, buttons and toggles on them, under any
   * host entry in {@link components}.
   */
  fieldRadius?: number;
  /**
   * See {@link fieldRadius}. An EXPLICIT value here wins over {@link density}'s
   * own derived height everywhere — `theme.fieldHeight` and the
   * `MuiOutlinedInput`/`MuiInputLabel` overrides both follow it. Unset, the
   * height density derives applies; with no density either,
   * `DEFAULT_FIELD_HEIGHT` (2.5), exactly as today.
   */
  fieldHeight?: number;
  /**
   * The theme's density, mirroring `@12-apps/ui`'s own `UiThemeOptions.density`
   * (`density.ts`'s own docblock has the full precedence table). Setting it
   * moves `typography.fontSize`, `theme.spacing(1)` and `theme.fieldHeight`
   * together, carries density's own MUI component overrides, and sets
   * `theme.density` (read by `useDensity()` and the data views). Unset, the
   * theme is byte-identical to today's — the release's compatibility
   * guarantee.
   *
   * **Changes the host-merge semantics of {@link components}.** Unset, a
   * host's entry REPLACES the whole component entry (unchanged, out of scope
   * here). Set, `components` merges by SLOT instead
   * (`@12-apps/ui`'s `mergeMuiComponents`): the README has the full account.
   */
  density?: DensityLevel | number;
  /** A repository's own factor for a named level, overriding the built-in table — see {@link density}. */
  densityFactors?: Partial<Record<DensityLevel, number>>;
}
