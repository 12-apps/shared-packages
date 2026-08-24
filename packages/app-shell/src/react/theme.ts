import { createTheme, type Theme } from '@12-apps/ui/mui/styles';

import { brandHex, DEFAULT_SURFACE, readableInk, separateFromBrand } from '../core/brand-palette';

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

/** The four meanings, as a host may state them. Any subset. */
export type SemanticTokens = Partial<Record<keyof typeof SEMANTIC_ANCHORS, string>>;

/** The two grounds MUI paints: the page, and anything raised off it. */
export interface ModeSurfaces {
  /** The page itself. */
  default: string;
  /** A card, a sheet, a menu — anything sitting on the page. */
  paper: string;
}

/**
 * The four meanings — the host's where it stated one, this package's otherwise,
 * and moved out of the brand's way when the brand lands on one.
 *
 * The defaults are MUI's own hexes. Naming them here changes nothing for a
 * platform-coloured app, and that is the point: it makes the invariant explicit
 * and gives `separateFromBrand` something anchored to rotate. Green stays good and
 * red stays stop in every tenant, because none of these is ever computed from the
 * tenant's seed.
 *
 * ## What counts as "the brand" here
 *
 * The EFFECTIVE primary: the tenant's seed when there is one, and otherwise the
 * host's own token. Both are the colour on the buttons a user presses, which is
 * the whole reason a semantic can be confused with it — and reading only the
 * tenant's is a hole the size of every un-white-labelled screen in the product.
 *
 * The failure is the one `separateFromBrand` was written for, so it is worth
 * being concrete. A host whose platform primary is `#D42B1F` sits 4° from this
 * module's own danger anchor `#d32f2f`. Its 'Remover' and its 'Adicionar' come
 * out the same colour on every default-branded screen, the rotation that exists
 * to prevent exactly that never fires, and the only tenants protected are the
 * ones who paid to replace the palette.
 *
 * Only the PRIMARY is guarded against. It is the colour on every button a user
 * actually presses; the secondary appears on far less, and guarding against both
 * would rotate two semantics for a brand whose two colours are merely near each
 * other.
 *
 * ## A semantic the HOST stated is never rotated
 *
 * Same rule as {@link brandRole} applies to `tokens`: a decision already made is
 * not re-derived. A host that says its danger is `#7C2A1C` has looked at its own
 * palette and at its own primary, and a factory second-guessing that would move
 * a colour the designer chose for reasons this module cannot see. Rotation is
 * for the anchors THIS package supplies, which no host has approved.
 */
function semantics(
  brand: string | null | undefined,
  stated: SemanticTokens | undefined,
): {
  success: { main: string };
  warning: { main: string };
  error: { main: string };
  info: { main: string };
} {
  const role = (key: keyof typeof SEMANTIC_ANCHORS): { main: string } => ({
    main: stated?.[key] ?? separateFromBrand(SEMANTIC_ANCHORS[key], brand),
  });
  return {
    success: role('success'),
    warning: role('warning'),
    error: role('error'),
    info: role('info'),
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
}

/**
 * The hex the legibility correction is measured against.
 *
 * Two options can answer this and they must not disagree, so the fallback chain
 * says which wins: an explicit {@link AppThemeOptions.surface}, then the ground
 * the host says it PAINTS, then this package's default.
 *
 * Deriving it from `background` is the point of the middle step. Before
 * `background` existed, a host with a tinted page had to state that page twice —
 * once to paint it and once for `surface` — and the two drifting apart has no
 * symptom: the correction still runs, still returns a legible tone, and returns
 * it for a page nobody is looking at. Now the common case needs one statement.
 *
 * `surface` stays, and stays FIRST, because the two are not always the same
 * question. A host may paint its page from something the palette never sees, or
 * read its tenant's text against a card rather than against the page behind it.
 * That is what an explicit value is for.
 */
function readingSurface(
  mode: ThemeMode,
  options: AppThemeOptions,
  background: ModeSurfaces | undefined,
): string {
  return options.surface?.[mode] ?? background?.default ?? DEFAULT_SURFACES[mode];
}

/** One role pair, as {@link brandRole} resolves it. */
type BrandRoles = {
  primary: { main: string; light?: string };
  secondary: { main: string; light?: string };
};

/** The two roles a tenant can replace, both corrected against the same surface. */
function brandRoles(
  override: PaletteOverride | null | undefined,
  tokens: ModeTokens,
  surface: string,
): BrandRoles {
  return {
    primary: brandRole(override?.primary, tokens.primary, surface),
    secondary: brandRole(override?.secondary, tokens.secondary, surface),
  };
}

/**
 * The keys MUI fills in for itself unless the host states them.
 *
 * Both omitted rather than passed as `undefined`, so a host that states neither
 * hands MUI byte-identical options to the ones it got before these keys existed.
 * MUI treats an explicit `undefined` the same way today; not depending on that
 * is what makes this additive rather than a change every consumer inherits.
 */
function statedGrounds(
  background: ModeSurfaces | undefined,
  divider: string | undefined,
): { background?: ModeSurfaces; divider?: string } {
  return {
    ...(background ? { background } : {}),
    ...(divider ? { divider } : {}),
  };
}

/**
 * The palette half, resolved: host tokens or the platform's, the grounds the host
 * paints, its own meanings where it stated any, and the tenant seed corrected
 * against whichever surface applies.
 *
 * Its own function because the theme has two halves and only one of them is this.
 * It is also assembled from four named pieces rather than written out, and that
 * is the complexity ceiling doing its job rather than a style preference: every
 * `?.` and `??` counts, this resolves eight optional inputs, and spelled inline
 * it lands at 12 against a maximum of 10.
 */
function themePalette(
  mode: ThemeMode,
  options: AppThemeOptions,
): BrandRoles & {
  mode: ThemeMode;
  success: { main: string };
  warning: { main: string };
  error: { main: string };
  info: { main: string };
  background?: ModeSurfaces;
  divider?: string;
} {
  const tokens = options.tokens?.[mode] ?? DEFAULT_THEME_TOKENS[mode];
  const background = options.background?.[mode];
  const { override } = options;

  return {
    mode,
    ...brandRoles(override, tokens, readingSurface(mode, options, background)),
    // The EFFECTIVE primary, not just the tenant's — see {@link semantics}.
    ...semantics(override?.primary ?? tokens.primary, options.semantics?.[mode]),
    ...statedGrounds(background, options.divider?.[mode]),
  };
}

/**
 * Build an MUI theme for the given mode using the shared design tokens.
 *
 * `override` lets a white-labelled host swap the palette while keeping every other
 * token identical — MUI's `augmentColor` derives the remaining shades and
 * `contrastText` from `main`, so a tenant hex needs no extra plumbing beyond the
 * legibility correction in {@link brandRole}.
 *
 * `components` is the host's, passed through untouched — see
 * {@link AppThemeOptions.components}.
 */
export function createAppTheme(mode: ThemeMode = 'light', options: AppThemeOptions = {}): Theme {
  return createTheme({
    palette: themePalette(mode, options),
    // Omitted entirely rather than passed as `undefined`: MUI treats an explicit
    // `components: undefined` the same as absent today, but the spread keeps the
    // built options identical to what a host that passed nothing used to get.
    ...(options.components ? { components: options.components } : {}),
  });
}
