import { chipClasses } from '@mui/material/Chip/index.js';
import { tableCellClasses } from '@mui/material/TableCell/index.js';
import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { rem, rems } from './relative';

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

/**
 * TOGGLEBUTTON / TAB / TABLECELL / PAGINATIONITEM / SLIDER GEOMETRY,
 * DENSITY-AWARE (FUT-2768).
 *
 * The remainder of the fixed-px geometry the density audit catalogued, none
 * of it hard-coded in `@12-apps/ui`'s own source. Verified against the
 * installed `@mui/material@6.5.0` source; each goes through the SAME
 * per-size/per-slot `overridesResolver` key MUI itself resolves
 * (`iconButtonDensityOverrides`/`chipDensityOverrides`'s own mechanism), so a
 * theme value composes with MUI's baked-in `variants` instead of replacing
 * them outright:
 *
 * - `ToggleButton`: `padding: 11/7/15` at medium(root)/small/large — same
 *   `root`/`sizeSmall`/`sizeLarge` shape as `iconButtonDensityOverrides`.
 * - `Tab`: `minHeight: 48`, `padding: '12px 16px'` on the root (via `rems()`).
 *   The icon+label combo (`minHeight: 72`, `paddingTop`/`Bottom: 9`) is a
 *   SEPARATE MUI variant gated on `ownerState.icon && ownerState.label`,
 *   exposed as the `labelIcon` key.
 * - `TableCell`: `padding: 16` on the root, `'6px 16px'` at small, nested
 *   inside it `'0 12px 0 16px'` on the small+checkbox combo
 *   (`& .${tableCellClasses.paddingCheckbox}`). `@12-apps/ui`'s own `Table`
 *   (FUT-2769) draws cell padding two classes deep under its styled root —
 *   higher specificity, so it always wins; this reaches a BARE `<TableCell>`.
 * - `PaginationItem`: `minWidth/height: 32/26/40` at medium(root)/small/large.
 *   The ellipsis shares the SAME slot and `minWidth` but has NO `height` of
 *   its own (`'auto'`), gated on `ownerState.type` being neither
 *   `'start-ellipsis'` nor `'end-ellipsis'` — skipping it would force a
 *   height onto the ellipsis (Lesson 1).
 * - `Slider`: rail `height: 4/2` at `orientation="horizontal"`/`size="small"`
 *   — gated on `ownerState.orientation` since the SAME key answers for
 *   EITHER axis (MUI sets `height` horizontal / `width` vertical, leaving
 *   the other `'100%'`). Thumb `20×20`/`12×12` is square at both sizes, no
 *   gate needed. `@12-apps/ui`'s own `Slider` already sets rail/thumb size
 *   unconditionally through `rem()` and never forwards `size` — a no-op
 *   THERE, but this still reaches a BARE `<Slider>`. The thumb's
 *   hover/active/`Mui-focusVisible` ring and the value-label offset were also
 *   checked and left OUT on purpose — measured in that story file's own doc.
 *
 * `Avatar` is NOT in this file: `@12-apps/ui`'s own `Avatar` wraps `MuiAvatar`
 * in a `StyledAvatar` that ALREADY sets `width`/`height` through
 * `rem(theme, boxPx(size))` (`40` at `md`), higher specificity than any
 * `MuiAvatar.styleOverrides.root` — dead code for every call site this
 * initiative reaches (the Done-when's own escape hatch), so it ships none.
 *
 * Geometry-neutral at `normal`; each slot a MODULE-LEVEL function, as above.
 */

const toggleButtonRootPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 11) });
const toggleButtonSmallPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 7) });
const toggleButtonLargePadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 15) });

/** `MuiToggleButton`'s own padding, at every size MUI has. */
export function toggleButtonDensityOverrides(): Components<Theme> {
  return {
    MuiToggleButton: {
      styleOverrides: {
        root: toggleButtonRootPadding,
        sizeSmall: toggleButtonSmallPadding,
        sizeLarge: toggleButtonLargePadding,
      },
    },
  };
}

const tabRootGeometry = ({ theme }: { theme: Theme }): CSSObject => ({
  minHeight: rem(theme, 48),
  padding: rems(theme, 12, 16),
});
const tabLabelIconGeometry = ({ theme }: { theme: Theme }): CSSObject => ({
  minHeight: rem(theme, 72),
  paddingTop: rem(theme, 9),
  paddingBottom: rem(theme, 9),
});

/** `MuiTab`'s own root height/padding, and the icon+label combo's taller box. */
export function tabDensityOverrides(): Components<Theme> {
  return {
    MuiTab: {
      styleOverrides: {
        root: tabRootGeometry,
        labelIcon: tabLabelIconGeometry,
      },
    },
  };
}

const tableCellRootPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 16) });
const tableCellSmallPadding = ({ theme }: { theme: Theme }): CSSObject => ({
  padding: rems(theme, 6, 16),
  // Nested, not a separate override key — MUI's own small-size variant nests
  // the checkbox-padding combo the same way (`TableCell.js`'s own `variants`
  // entry for `size: 'small'`). `tableCellClasses.paddingCheckbox`, not a
  // hand-typed `.MuiTableCell-paddingCheckbox` string, for the same reason
  // `chipClasses.label` is used above.
  [`&.${tableCellClasses.paddingCheckbox}`]: {
    padding: rems(theme, 0, 12, 0, 16),
  },
});

/**
 * `MuiTableCell`'s own default/small padding, and small's own nested
 * checkbox-padding combo. Reaches a BARE `<TableCell>` only — see the module
 * doc comment for why `@12-apps/ui`'s own `Table` (FUT-2769) is unaffected.
 */
export function tableCellDensityOverrides(): Components<Theme> {
  return {
    MuiTableCell: {
      styleOverrides: {
        root: tableCellRootPadding,
        sizeSmall: tableCellSmallPadding,
      },
    },
  };
}

/** The `ownerState` field that tells the ellipsis item apart from a real button. */
interface PaginationItemOwnerStateForOverrides {
  type?: 'page' | 'first' | 'last' | 'start-ellipsis' | 'end-ellipsis' | 'previous' | 'next';
}
type PaginationItemStyleFn = (props: {
  theme: Theme;
  ownerState?: PaginationItemOwnerStateForOverrides;
}) => CSSObject;

const isPaginationEllipsis = (type: PaginationItemOwnerStateForOverrides['type']): boolean =>
  type === 'start-ellipsis' || type === 'end-ellipsis';

/** `minWidth` always; `height` only off the ellipsis, which has none of its own. */
function paginationItemGeometryAt(px: number): PaginationItemStyleFn {
  return ({ theme, ownerState }) => {
    const style: CSSObject = { minWidth: rem(theme, px) };
    if (!isPaginationEllipsis(ownerState?.type)) style.height = rem(theme, px);
    return style;
  };
}
const paginationItemRootGeometry = paginationItemGeometryAt(32);
const paginationItemSmallGeometry = paginationItemGeometryAt(26);
const paginationItemLargeGeometry = paginationItemGeometryAt(40);

/**
 * `MuiPaginationItem`'s own `minWidth`/`height`, at every size MUI has —
 * `height` skipped on the ellipsis item, which has none of its own (`auto`).
 */
export function paginationItemDensityOverrides(): Components<Theme> {
  return {
    MuiPaginationItem: {
      styleOverrides: {
        root: paginationItemRootGeometry,
        sizeSmall: paginationItemSmallGeometry,
        sizeLarge: paginationItemLargeGeometry,
      },
    },
  };
}

/** The `ownerState` field that tells which axis the rail's `height`/`4` reads as. */
interface SliderOwnerStateForOverrides {
  orientation?: 'horizontal' | 'vertical';
}
type SliderStyleFn = (props: { theme: Theme; ownerState?: SliderOwnerStateForOverrides }) => CSSObject;

/** The rail's `4`/`2` reads as `height` for a horizontal slider, `width` for a vertical one. */
function sliderRailAxisAt(px: number): SliderStyleFn {
  return ({ theme, ownerState }) =>
    ownerState?.orientation === 'vertical' ? { width: rem(theme, px) } : { height: rem(theme, px) };
}
const sliderRootGeometry = sliderRailAxisAt(4);
const sliderSmallGeometry = sliderRailAxisAt(2);
const sliderThumbGeometry = ({ theme }: { theme: Theme }): CSSObject => ({
  width: rem(theme, 20),
  height: rem(theme, 20),
});
const sliderThumbSmallGeometry = ({ theme }: { theme: Theme }): CSSObject => ({
  width: rem(theme, 12),
  height: rem(theme, 12),
});

/** `MuiSlider`'s own rail thickness (root/sizeSmall) and thumb box (thumb/thumbSizeSmall). */
export function sliderDensityOverrides(): Components<Theme> {
  return {
    MuiSlider: {
      styleOverrides: {
        root: sliderRootGeometry,
        sizeSmall: sliderSmallGeometry,
        thumb: sliderThumbGeometry,
        thumbSizeSmall: sliderThumbSmallGeometry,
      },
    },
  };
}

/**
 * `MuiTabs`' own indicator thickness (`height: 2` horizontal, `width: 2`
 * vertical) — one short of `Tab` in the ticket's own literal list, added
 * after a FUT-2767-review pass over state/orientation-gated literals; same
 * orientation gate as the Slider rail. `@12-apps/ui`'s own `Tabs` draws its
 * OWN 3px indicator through `rem()` already, blocking THIS override there —
 * `tabDensityOverrides` reaches `Tab.root`'s `minHeight` instead (both
 * measured in `density-wrapper-reach.test.stories.tsx`).
 */
interface TabsIndicatorOwnerStateForOverrides {
  orientation?: 'horizontal' | 'vertical';
}
type TabsIndicatorStyleFn = (props: {
  theme: Theme;
  ownerState?: TabsIndicatorOwnerStateForOverrides;
}) => CSSObject;

const tabsIndicatorAxisAt: TabsIndicatorStyleFn = ({ theme, ownerState }) =>
  ownerState?.orientation === 'vertical' ? { width: rem(theme, 2) } : { height: rem(theme, 2) };

/** `MuiTabs`' own indicator thickness, by orientation. */
export function tabsIndicatorDensityOverrides(): Components<Theme> {
  return {
    MuiTabs: {
      styleOverrides: {
        indicator: tabsIndicatorAxisAt,
      },
    },
  };
}
