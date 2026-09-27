import { chipClasses } from '@mui/material/Chip/index.js';
import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { rem } from './relative';

/** The `ownerState` fields `MuiChip`'s two styled slots (root, label) both receive. */
interface ChipOwnerStateForOverrides {
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
}

/**
 * ICONBUTTON / CHIP GEOMETRY, DENSITY-AWARE (FUT-2766).
 *
 * Both are MUI's own components, unwrapped: `@12-apps/ui` has no
 * `components/*` subpath for `IconButton`, and its `Chip` wrapper
 * (`components/data-display/Chip`) hands the drawing to `MuiChip` and adds
 * only hover/selection/transition `sx` — no geometry of its own (unlike
 * `Button`, which already draws every dimension through `rem()`,
 * `components/form/Button/Button.styles.ts`). So both draw MUI's OWN fixed-px
 * padding/height, verified against the installed `@mui/material@6.5.0` source:
 *
 * - `IconButton` (`node_modules/@mui/material/IconButton/IconButton.js`):
 *   `padding: 8` on the root (medium, the default), `padding: 5` at
 *   `size="small"`, `padding: 12` at `size="large"`. The icon's own `fontSize`
 *   is already relative (`pxToRem(18/24/28)`) — only `padding` was the gap.
 * - `Chip` (`node_modules/@mui/material/Chip/Chip.js`): `height: 32` on the
 *   root (medium, the default), `height: 24` at `size="small"`. The label's
 *   own side padding is a SEPARATE slot (`name: 'MuiChip', slot: 'Label'`,
 *   override key `label`/`labelSmall`) at `paddingLeft`/`paddingRight: 12`
 *   default, `8` at `size="small"` — restated in this package's own
 *   `Chip.metrics.ts` (`CHIP_SIZES`), which both renderers already read.
 *
 * Neither dimension moved when `theme.typography.fontSize` changed (they are
 * not written through `pxToRem`), so at `density: 'compact'` an
 * `IconButton`/`Chip` next to a now-smaller `Button` looked unchanged — the
 * visual regression FUT-2764 exists to fix. `rem(theme, px)` is the same
 * helper `Button.styles.ts` already uses, so `padding`/`height` move exactly
 * as far as `theme.typography.fontSize`'s coefficient does, and are
 * geometry-neutral at `density: 'normal'`: `rem(theme, 8)` at the unchanged
 * `fontSize: 14` renders to the same computed px as the literal `8` it
 * replaces.
 *
 * **The OUTLINED chip's own label padding (`11`/`7`, one px tighter than
 * filled's `12`/`8`) is a SEPARATE number this file must not clobber** — a
 * bug an earlier revision of this file had (a `styleOverrides.label`/
 * `labelSmall` of `12`/`8` unconditionally wins for EVERY variant, because
 * `ChipLabel`'s own `overridesResolver` (`Chip.js`) returns
 * `[styles.label, styles[label${size}]]` with no variant check at all, and
 * `@mui/system`'s `createStyled` composes `styleThemeOverrides` AFTER the
 * slot's own base styles/variants — so a theme `styleOverrides.label` always
 * outranks `ChipLabel`'s own baked-in `{ props: { variant: 'outlined' },
 * style: { paddingLeft: 11, ... } }`, at ANY density, not just a scaled one).
 * Fixed by putting the outlined fix on the ROOT slot instead, as a nested
 * `.MuiChip-label` selector inside `styleOverrides.root` itself, keyed on
 * `ownerState.variant`/`.size` — proven correct two ways: (1) a probe render
 * confirmed the naive `components.MuiChip.variants` route CANNOT reach the
 * label slot at all — `createStyled`'s `skipVariantsResolver` defaults to
 * `true` for every slot but `'Root'`, so a theme-level `variants` entry is
 * simply never evaluated for `ChipLabel`, proven by rendering an outlined
 * Chip against a `components.MuiChip.variants` entry set to an absurd
 * `999px` and reading `.MuiChip-label`'s OWN computed style: still `11px`,
 * untouched — while the SAME entry DOES leak onto `.MuiChip-root` (`999px`),
 * confirming theme `variants` is a ROOT-slot-only mechanism for this
 * component; (2) a nested `.MuiChip-label` selector written from the ROOT
 * slot is a HIGHER-specificity rule (two classes, `0,2,0`) than the label's
 * own single-class rule (`0,1,0`), so it wins regardless of source order —
 * the same technique `ChipRoot`'s OWN style already uses for its avatar/
 * icon/delete-icon sub-parts (`& .${chipClasses.avatar}`, etc., in
 * `Chip.js`), and read through the SAME `chipClasses` MUI's own `Chip.js`
 * generates the real DOM class from, not a hand-typed copy of it.
 *
 * **That same higher specificity also outranks a HOST's own theming.** A
 * host writing `theme.components.MuiChip.styleOverrides.label` for its own
 * reasons (`0,1,0`) does not win against the outlined rule here (`0,2,0`) —
 * not a bug specific to this file, `ChipLabel`'s OWN baked-in outlined
 * variant already outranked a plain `styleOverrides.label` the same way,
 * before this file existed. A host that needs to change OUTLINED label
 * padding specifically cannot do it through `styleOverrides.label`/
 * `labelSmall` at all; it reaches it through `sx` (a per-instance override,
 * highest specificity of all) or its OWN `MuiChip.styleOverrides.root`
 * function written out in full — `mergeMuiComponents` replaces `root`
 * WHOLESALE when both sides set it (see `./density.ts`'s own doc comment),
 * so a host adding to it must restate `chipRootHeight`'s own height logic
 * alongside its outlined-label change, not merely add a sibling key.
 *
 * The avatar/icon/delete-icon sub-slots (margins, sizes) and IconButton's
 * `edge="start"`/`"end"` negative margins are DELIBERATELY untouched by this
 * file — real override keys exist, but none is in the ticket's Done-when nor
 * exercised by a call site this initiative is chasing, so they stay MUI's
 * own literals at every density (including `compact`/`comfortable` — they do
 * NOT scale here; a future ticket that needs them scaled adds its own
 * override, the way `field-height.ts`'s siblings each own one slot).
 *
 * A host that adopts `iconButtonDensityOverrides`/`chipDensityOverrides`
 * standalone (the `@12-apps/ui/tokens` export, no density channel involved)
 * sees the SAME scaling from its own `typography.fontSize` alone — `rem()`
 * only ever reads that one theme number, so a theme with a non-default
 * `fontSize` (set directly, with no `density` in the picture at all) moves
 * these numbers exactly as it moves everything else written through `rem()`.
 *
 * Each slot below is a MODULE-LEVEL function, not a closure built fresh inside
 * `iconButtonDensityOverrides`/`chipDensityOverrides` — the same reason
 * `field-height.ts`'s `restingEdge` is one: two themes built from the same
 * options (the `muiThemeOptionsFrom` and `densityThemeOptions` paths, in
 * particular) must compare equal, and a fresh arrow function per call would
 * make them differ on nothing but identity.
 */

const iconButtonRootPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 8) });
const iconButtonSmallPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 5) });
const iconButtonLargePadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 12) });

/** `MuiIconButton`'s own padding, at every size MUI has. */
export function iconButtonDensityOverrides(): Components<Theme> {
  return {
    MuiIconButton: {
      styleOverrides: {
        root: iconButtonRootPadding,
        sizeSmall: iconButtonSmallPadding,
        sizeLarge: iconButtonLargePadding,
      },
    },
  };
}

/** MUI's own outlined-label paddings (`ChipLabel`'s baked-in `variants`, `Chip.js`). */
const CHIP_OUTLINED_LABEL_PADDING = { medium: 11, small: 7 } as const;

const chipRootHeight = ({
  theme,
  ownerState,
}: {
  theme: Theme;
  ownerState?: ChipOwnerStateForOverrides;
}): CSSObject => {
  const style: CSSObject = { height: rem(theme, 32) };
  if (ownerState?.variant === 'outlined') {
    const px = CHIP_OUTLINED_LABEL_PADDING[ownerState.size === 'small' ? 'small' : 'medium'];
    // Higher CSS specificity than `.MuiChip-label`'s own single-class rule
    // (two classes vs one) — wins over `chipLabelPadding`/`chipLabelSmallPadding`
    // below regardless of stylesheet insertion order. See the module doc
    // comment for why this must live here and not on the label slot itself.
    // `chipClasses.label`, not a hand-typed `.MuiChip-label` string — the same
    // module `Chip.js`'s own root style reads for its avatar/icon/delete-icon
    // selectors, so this tracks whatever `Chip.js` itself puts on the label
    // element rather than a separately-maintained copy of it. A host that
    // calls `ClassNameGenerator.configure` before any `MuiChip` module loads
    // renames the real class; a literal string would silently stop matching
    // it, `chipClasses.label` cannot.
    style[`& .${chipClasses.label}`] = { paddingLeft: rem(theme, px), paddingRight: rem(theme, px) };
  }
  return style;
};
const chipSmallHeight = ({ theme }: { theme: Theme }): CSSObject => ({ height: rem(theme, 24) });
const chipLabelPadding = ({ theme }: { theme: Theme }): CSSObject => ({
  paddingLeft: rem(theme, 12),
  paddingRight: rem(theme, 12),
});
const chipLabelSmallPadding = ({ theme }: { theme: Theme }): CSSObject => ({
  paddingLeft: rem(theme, 8),
  paddingRight: rem(theme, 8),
});

/** `MuiChip`'s own height (root) and label side padding (label), at both sizes MUI has. */
export function chipDensityOverrides(): Components<Theme> {
  return {
    MuiChip: {
      styleOverrides: {
        root: chipRootHeight,
        sizeSmall: chipSmallHeight,
        label: chipLabelPadding,
        labelSmall: chipLabelSmallPadding,
      },
    },
  };
}
