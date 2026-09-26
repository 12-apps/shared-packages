import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { rem } from './relative';

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
 * Out of scope (the ticket's own Decision draws the line here): the
 * OUTLINED chip's own label padding (`11`/`7`) is baked into `ChipLabel`'s
 * `variants` array with no matching `styleOverrides` key MUI's
 * `overridesResolver` forwards (only `label`/`labelSmall` are, i.e. the
 * FILLED numbers) — reaching it would need `components.MuiChip.variants`,
 * a different mechanism, for two numbers the Done-when does not test. Same
 * for the avatar/icon/delete-icon sub-slots: real override keys, but neither
 * in the Done-when nor exercised by a call site this initiative is chasing.
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

const chipRootHeight = ({ theme }: { theme: Theme }): CSSObject => ({ height: rem(theme, 32) });
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
