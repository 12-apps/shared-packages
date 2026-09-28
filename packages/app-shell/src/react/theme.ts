import { createTheme, type Theme } from '@12-apps/ui/mui/styles';
import {
  DEFAULT_FIELD_HEIGHT,
  DEFAULT_FIELD_RADIUS,
  densityThemeOptions,
  fieldHeightOverrides,
  fieldOverrides,
  mergeMuiComponents,
  resolveDensityFactor,
  type DensityLevel,
} from '@12-apps/ui/tokens';

import { brandHex, DEFAULT_SURFACES as CORE_SURFACES, readableInk, separateFromBrand } from '../core/brand-palette';

// `AppThemeOptions` and its supporting types live in `./theme-options` — see
// that module's own docblock for why. The publicly re-exported ones (this
// package's `react/index.ts` names each) are re-exported here so the import
// path an adopter already writes (`from '@12-apps/app-shell/react'`) is
// unchanged; `ModeSurfaces`/`SemanticTokens` were never part of that public
// surface and stay a plain (type-only) import, used internally below.
export {
  DEFAULT_THEME_TOKENS,
  type AppThemeOptions,
  type ModeTokens,
  type PaletteOverride,
  type ThemeMode,
} from './theme-options';
import type { AppThemeOptions, ModeSurfaces, ModeTokens, PaletteOverride, SemanticTokens, ThemeMode } from './theme-options';
import { DEFAULT_THEME_TOKENS as DEFAULT_TOKENS } from './theme-options';

/**
 * The shape `mergeMuiComponents` itself takes, derived the same way
 * {@link AppThemeOptions.components} is (see `./theme-options`). The two
 * describe the same runtime shape — MUI's `Components<Theme>` for THIS
 * package's `Theme` — but `createTheme` is overloaded onto a slightly
 * different `Theme` instantiation, so a value typed as one needs this cast to
 * reach the other.
 */
type MergeableComponents = Parameters<typeof mergeMuiComponents>[number];

/**
 * ## THE CORE'S BINDING, not a copy of it
 *
 * The core owns both values and this entry has always published the name, so
 * an earlier change re-exported it here — as `{ ...CORE_SURFACES }`, and then said in
 * this docblock that it was "the same record". A spread is not the same record.
 * `import { DEFAULT_SURFACES } from '@12-apps/app-shell'` and the same name
 * `from '@12-apps/app-shell/react'` were never `===`, and their TYPES differed
 * too: the core's is `as const`, this one was widened to
 * `Record<ThemeMode, string>`.
 *
 * Harmless while every consumer only indexes it, which every consumer audited
 * for this change does. It is the kind of thing that is only ever
 * noticed by the person it breaks — an identity check, a `Map` keyed by the
 * record, a test asserting one against the other — so the copy is gone rather
 * than documented.
 *
 * The widened type went with it, and nothing wanted it: the core's readonly
 * literal indexes by {@link ThemeMode} exactly as well, because `SurfaceMode`
 * IS `'light' | 'dark'`. What it stops allowing is a write, which was never a
 * thing to allow — a host replaces the surface through
 * {@link AppThemeOptions.surface}, not by assigning into the default.
 */
export { DEFAULT_SURFACES } from '../core/brand-palette';

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
  return options.surface?.[mode] ?? background?.default ?? CORE_SURFACES[mode];
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
  const tokens = options.tokens?.[mode] ?? DEFAULT_TOKENS[mode];
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
 * Whether an explicit field height differs from the one density derives, and
 * the height that wins — its own function so {@link createAppTheme}'s density
 * branch reads as one thought instead of three chained `?:`/`??`/`!==`.
 */
function effectiveFieldHeight(
  explicitHeight: number | undefined,
  densityHeight: number,
): { height: number; explicitDiffers: boolean } {
  if (explicitHeight === undefined) return { height: densityHeight, explicitDiffers: false };
  return { height: explicitHeight, explicitDiffers: explicitHeight !== densityHeight };
}

/**
 * The density branch of {@link createAppTheme} — one `createTheme()` call, per
 * `@12-apps/ui`'s own `densityThemeOptions` docblock (MUI only runs
 * `createSpacing`/`createTypography` on its FIRST argument). `theme.density`
 * is set afterwards so `useDensity()` and the data views read it. `components`
 * composes, later winning per slot (`mergeMuiComponents`): density's own,
 * then `fieldHeightOverrides` ONLY when an explicit height differs from
 * density's, then the host's own {@link AppThemeOptions.components}.
 */
function densityAppTheme(
  mode: ThemeMode,
  options: AppThemeOptions,
  density: DensityLevel | number,
  fieldRadius: number,
): Theme {
  const densityOptions = densityThemeOptions(density, options.densityFactors, fieldRadius);
  const { height, explicitDiffers } = effectiveFieldHeight(
    options.fieldHeight,
    densityOptions.fieldHeight ?? DEFAULT_FIELD_HEIGHT,
  );

  const theme = createTheme({
    palette: themePalette(mode, options),
    fieldRadius,
    ...densityOptions,
    fieldHeight: height,
    components: mergeMuiComponents(
      densityOptions.components ?? {},
      ...(explicitDiffers ? [fieldHeightOverrides(height)] : []),
      (options.components ?? {}) as MergeableComponents,
    ),
  });
  theme.density = resolveDensityFactor(density, options.densityFactors);
  return theme;
}

/**
 * Build an MUI theme for the given mode using the shared design tokens.
 *
 * `override` lets a white-labelled host swap the palette while keeping every other
 * token identical — MUI's `augmentColor` derives the remaining shades and
 * `contrastText` from `main`, so a tenant hex needs no extra plumbing beyond the
 * legibility correction in {@link brandRole}.
 *
 * `components` is the host's, laid over the field-radius overrides — see
 * {@link AppThemeOptions.components} and {@link AppThemeOptions.fieldRadius}.
 *
 * **No {@link AppThemeOptions.density}: unchanged.** Today's code path,
 * byte-for-byte — the release's whole compatibility guarantee. A density
 * hands off to {@link densityAppTheme}, whose own docblock has that half.
 */
export function createAppTheme(mode: ThemeMode = 'light', options: AppThemeOptions = {}): Theme {
  const { fieldRadius = DEFAULT_FIELD_RADIUS, density } = options;
  if (density !== undefined) return densityAppTheme(mode, options, density, fieldRadius);

  const { fieldHeight = DEFAULT_FIELD_HEIGHT } = options;
  return createTheme({
    palette: themePalette(mode, options),
    fieldRadius,
    fieldHeight,
    // The field corner and height first, the host's own overrides over them.
    components: { ...fieldOverrides(fieldRadius, fieldHeight), ...options.components },
  });
}
