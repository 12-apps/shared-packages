import { tableCellClasses } from '@mui/material/TableCell/index.js';
import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { rem, rems } from './relative';

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
 *   SEPARATE MUI variant, exposed as the `labelIcon` key.
 * - `TableCell`: `padding: 16` on the root, `'6px 16px'` at small, nested
 *   inside it `'0 12px 0 16px'` on the small+checkbox combo — all gated on
 *   `ownerState.padding === 'normal'` (MUI's default): `checkbox`/`none` are
 *   separate variants with their OWN unscaled padding (`'0 0 0 4px'`/`0`) an
 *   unconditional rule clobbered at every size but small (FUT-2861 review —
 *   the SAME Lesson-1 clobber the ellipsis fix above avoids, missed here).
 *   `@12-apps/ui`'s own `Table` (FUT-2769) wins regardless (two classes deep
 *   under its styled root); this reaches a BARE `<TableCell>`.
 * - `PaginationItem`: `minWidth/height: 32/26/40` at medium(root)/small/large.
 *   The ellipsis shares the SAME slot and `minWidth` but has NO `height` of
 *   its own (`'auto'`), gated on `ownerState.type` being neither
 *   `'start-ellipsis'` nor `'end-ellipsis'` — skipping it would force a
 *   height onto the ellipsis (Lesson 1).
 * - `Slider`: rail `height: 4/2` at `orientation="horizontal"`/`size="small"`
 *   — gated on `ownerState.orientation` since the SAME key answers for either
 *   axis (MUI sets `height` horizontal / `width` vertical, leaving the other
 *   `'100%'`). Thumb `20×20`/`12×12` needs no gate. `@12-apps/ui`'s own
 *   `Slider` already sets rail/thumb size through `rem()` and never forwards
 *   `size` — a no-op THERE, reaches a BARE `<Slider>`. The thumb's ring and
 *   the value-label offset were checked and left OUT — that story's own doc.
 *
 * `Avatar` is NOT in this file: `@12-apps/ui`'s own `Avatar` wraps `MuiAvatar`
 * in a `StyledAvatar` that ALREADY sets `width`/`height` through
 * `rem(theme, boxPx(size))` (`40` at `md`) — higher specificity than any
 * `MuiAvatar.styleOverrides.root`, dead code here, so it ships none.
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

interface TableCellOwnerStateForOverrides {
  padding?: 'normal' | 'checkbox' | 'none';
}
type TableCellStyleFn = (props: { theme: Theme; ownerState?: TableCellOwnerStateForOverrides }) => CSSObject;
const isDefaultTableCellPadding = (padding: TableCellOwnerStateForOverrides['padding']): boolean =>
  padding === undefined || padding === 'normal';

const tableCellRootPadding: TableCellStyleFn = ({ theme, ownerState }) =>
  isDefaultTableCellPadding(ownerState?.padding) ? { padding: rem(theme, 16) } : {};

const tableCellSmallPadding: TableCellStyleFn = ({ theme, ownerState }) => {
  const style: CSSObject = {
    [`&.${tableCellClasses.paddingCheckbox}`]: { padding: rems(theme, 0, 12, 0, 16) },
  };
  if (isDefaultTableCellPadding(ownerState?.padding)) style.padding = rems(theme, 6, 16);
  return style;
};

/** Reaches a BARE `<TableCell>` only — module doc comment above. */
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
