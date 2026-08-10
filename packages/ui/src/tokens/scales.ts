import type { Theme } from '@mui/material/styles';

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
 * DERIVE, DON'T COPY, AND SUBSET HONESTLY. A component that cannot draw the
 * whole scale narrows with `Extract` rather than restating a union — an
 * independent copy is what drifts. And it narrows rather than accepting the lot:
 * a MUI chip draws two sizes, so putting `lg` in its type would promise
 * something nothing can render.
 *
 *     size?: Extract<SizeValue, 'sm' | 'md'>;
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
 */
export type SizeValue = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

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
 */
export type ColorValue =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'info'
  | 'danger'
  | 'neutral';

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
export interface Accent {
  main: string;
  light: string;
  dark: string;
  contrastText: string;
}

export function accentFor(theme: Theme, color: ColorValue): Accent {
  if (color === 'neutral') {
    const grey = theme.palette.grey;
    return {
      // Explicit fallbacks: the ramp is indexed, and under
      // `noUncheckedIndexedAccess` every stop is `string | undefined`.
      main: grey[600] ?? '#757575',
      light: grey[400] ?? '#bdbdbd',
      dark: grey[800] ?? '#424242',
      // Grey 600 carries white text in both themes.
      contrastText: '#fff',
    };
  }
  // Past the `neutral` return, `paletteKey` can only produce a `MuiColor` — but
  // its signature still admits `'grey'`, and TS cannot narrow a return type by
  // the argument. Naming the key here keeps the accent branch honestly typed
  // instead of casting the hole shut.
  const key: MuiColor = color === 'danger' ? 'error' : color;
  return theme.palette[key];
}
