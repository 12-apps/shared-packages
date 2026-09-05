/**
 * THE TWO VOCABULARIES EVERY COMPONENT SPEAKS.
 *
 * Before this file the package had both halves of every argument at once: 26
 * components sized themselves `xs|sm|md|lg|xl` and four used MUI's
 * `small|medium|large`; 14 coloured themselves `danger|neutral` and 15 used
 * MUI's `error`. Nothing enforced either, because most of these props were
 * spelled out as inline unions and a couple were plain `string`.
 *
 * That is not a tidiness problem. A caller learns the vocabulary from whichever
 * component they used first, and the wrong half is not rejected — it reaches MUI
 * as an unknown value and silently falls back. `Chip` shipped with `color?:
 * string` and MUI's `small|medium`, so `color="danger"` rendered grey and
 * `size="sm"` rendered medium; twelve live call sites were doing exactly that,
 * and every test passed because they all asserted on text.
 *
 * So the vocabulary is declared once, here, and components derive from it.
 *
 * DERIVE, DON'T COPY — AND TAKE THE WHOLE VOCABULARY. Every size prop is
 * `SizeValue` and every colour prop is `ColorValue`, with no `Extract` and no
 * `Exclude`. Handing a component a slice was tried and undone: it is the same
 * fragmentation wearing the canonical type's name, and it leaves a caller having
 * to remember which components accept `xs` and which accept `info`. Where the
 * underlying widget draws fewer steps than five, that is a rendering detail and
 * belongs at the MUI boundary below — not in the prop's type.
 *
 * A component whose size or colour is not this concept at all keeps its own type
 * — `Scrollbar`'s `thin|medium|thick` is a track width, `Sheet`'s `full` is a
 * viewport fraction, `LazyImage`'s size is pixels. Forcing those into the scale
 * would be consistency for its own sake.
 */

/**
 * The house size scale.
 *
 * Abbreviated, because that is what 26 of the 30 components with a real size
 * already used and what every caller has been taught to write.
 *
 * Declared as the array and the type together so the two cannot disagree. The
 * runtime list is what Storybook `argTypes.options` and the demo grids iterate;
 * spelled by hand in each story it drifts, and it had — twelve colour lists
 * omitted `info`, so the control that documents the vocabulary offered a
 * component less than the component accepted.
 */
/**
 * The type scale is the THIRD vocabulary, and it lives in `./typography.ts`
 * because it is metrics rather than a prop union. Re-exported here so
 * `@12-apps/ui/tokens` stays the one import path for "what words does this
 * package speak" — a second entry point is how a vocabulary gets missed.
 */
export {
  HEADING_LEVELS,
  HEADING_SCALE,
  type HeadingLevel,
  type HeadingMetrics,
  type HeadingScaleOverrides,
} from './heading-scale';

export type SizeValue = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const SIZE_VALUES = ['xs', 'sm', 'md', 'lg', 'xl'] as const satisfies readonly SizeValue[];

/**
 * The house colour vocabulary.
 *
 * `danger` and `neutral` are OURS; the rest are MUI's own names already. That
 * sentence started life in `Button.tsx`, which is the component most callers
 * meet first and therefore the one that taught the vocabulary — so it is the one
 * the rest of the package follows.
 *
 * Components that hand these to MUI translate at the boundary (`danger` →
 * `error`, `neutral` → `default` or `inherit` depending on what the underlying
 * component calls its unaccented state). The translation must be a real mapping
 * and never a cast: a cast is precisely what let `danger` through untouched and
 * had MUI fall back to grey.
 *
 * Array and type declared together, for the reason given on {@link SIZE_VALUES}.
 */
export type ColorValue =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'info'
  | 'danger'
  | 'neutral';

export const COLOR_VALUES = [
  'primary',
  'secondary',
  'success',
  'warning',
  'info',
  'danger',
  'neutral',
] as const satisfies readonly ColorValue[];

/* ── Array and union, pinned to each other ────────────────────────────────── */

/**
 * The arrays above are written out rather than derived, because deriving the
 * union from the array (`(typeof COLOR_VALUES)[number]`) costs the alias its
 * name: TypeScript resolves the indexed access eagerly, and every error in the
 * package stops saying `not assignable to type 'ColorValue'` and starts dumping
 * seven string literals. In a package whose entire purpose is teaching this
 * vocabulary, the name in the error message is worth keeping.
 *
 * Writing both means they could disagree, so both directions are checked here.
 * `satisfies` above catches an entry that is not a member. These catch the other
 * half — a member missing from the array — which `satisfies` cannot see and
 * which is the direction that actually bit: twelve story control lists offered
 * six colours for a vocabulary of seven, so `info` was undocumented everywhere.
 *
 * A gap makes the assignment below fail, and the error names the missing member.
 */
type Missing<Union extends string, Listed extends string> = Exclude<Union, Listed>;

const _allSizesListed: Missing<SizeValue, (typeof SIZE_VALUES)[number]> extends never
  ? true
  : never = true;

const _allColorsListed: Missing<ColorValue, (typeof COLOR_VALUES)[number]> extends never
  ? true
  : never = true;

void _allSizesListed;
void _allColorsListed;

/* ── The MUI boundary ─────────────────────────────────────────────────────── */

/** What MUI calls a size. Three entries against our five. */
export type MuiSize = 'small' | 'medium' | 'large';

/**
 * The house scale collapsed onto MUI's three.
 *
 * Five onto three loses information, and it loses it at the ends on purpose:
 * `xs`/`sm` both draw small and `lg`/`xl` both draw large, because MUI has no
 * fourth and fifth step to give them. A component that genuinely needs five
 * distinct sizes styles them itself rather than routing through here — this is
 * for the ones that just forward the prop.
 */
export const muiSize = (size: SizeValue): MuiSize => {
  if (size === 'xs' || size === 'sm') return 'small';
  return size === 'md' ? 'medium' : 'large';
};

/** What MUI calls a semantic colour on most components. */
export type MuiColor = 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error';

/**
 * The house vocabulary translated for MUI, with the caller naming its neutral.
 *
 * `neutral` is the awkward one: MUI spells the unaccented state `default` on a
 * chip, `inherit` on a button and an icon button, and `grey` in the palette. So
 * the caller passes the word its own MUI component uses rather than this
 * pretending there is one answer.
 *
 * A MAPPING, NEVER A CAST. The cast is what let `danger` reach MUI untouched and
 * silently fall back to grey.
 */
export function muiColor<N extends string>(color: ColorValue, neutralAs: N): MuiColor | N {
  if (color === 'danger') return 'error';
  return color === 'neutral' ? neutralAs : color;
}

/**
 * The house vocabulary as a `theme.palette` key.
 *
 * Separate from {@link muiColor} because the palette has no `default` and no
 * `inherit` — an unaccented colour there is `grey`.
 */
export type PaletteKey = MuiColor | 'grey';

export const paletteKey = (color: ColorValue): PaletteKey =>
  color === 'danger' ? 'error' : color === 'neutral' ? 'grey' : color;

/**
 * A `ColorValue` resolved to a four-stop accent from the theme.
 *
 * `paletteKey` is not enough on its own for anything that reads `.main`: MUI's
 * palette has no neutral `PaletteColor`, and `palette.grey` is a 50–900 ramp
 * with no `main`, `light`, `dark` or `contrastText` on it at all. So `neutral`
 * is resolved from the ramp here, once, instead of every component discovering
 * the same hole and branching around it.
 *
 * Typed against the theme structurally so this file does not drag in MUI's
 * `Theme` and become a dependency of everything that imports a token.
 */
