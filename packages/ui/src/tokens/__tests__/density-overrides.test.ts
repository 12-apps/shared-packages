import { createTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { densityFontSize } from '../density.core';
import {
  chipDensityOverrides,
  iconButtonDensityOverrides,
  paginationItemDensityOverrides,
  sliderDensityOverrides,
  tabDensityOverrides,
  tableCellDensityOverrides,
  tabsIndicatorDensityOverrides,
  toggleButtonDensityOverrides,
} from '../density-overrides';

/**
 * FUT-2766 — `IconButton`/`Chip` geometry through the theme's density knob.
 *
 * Every assertion here is at the STYLE-OBJECT level (a style-override callback
 * invoked with a real `{ theme }`), proving the numbers `rem(theme, px)`
 * produces; the computed-PIXEL, real-browser proof (jsdom does not fully
 * resolve `rem` the way a browser does) is
 * `density-overrides.test.stories.tsx`.
 */

interface ChipOwnerStateArg {
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
}

/** The `ownerState` shapes every FUT-2768 override reads, unioned for the shared `slot` helper. */
interface OwnerStateArg {
  variant?: string;
  size?: string;
  type?: string;
  orientation?: string;
  padding?: string;
}

type StyleFn = (props: { theme: Theme; ownerState?: OwnerStateArg }) => Record<string, unknown>;

type AnyDensityOverrides =
  | ReturnType<typeof iconButtonDensityOverrides>
  | ReturnType<typeof chipDensityOverrides>
  | ReturnType<typeof toggleButtonDensityOverrides>
  | ReturnType<typeof tabDensityOverrides>
  | ReturnType<typeof tabsIndicatorDensityOverrides>
  | ReturnType<typeof tableCellDensityOverrides>
  | ReturnType<typeof paginationItemDensityOverrides>
  | ReturnType<typeof sliderDensityOverrides>;

function slot(
  overrides: AnyDensityOverrides,
  component:
    | 'MuiIconButton'
    | 'MuiChip'
    | 'MuiToggleButton'
    | 'MuiTab'
    | 'MuiTabs'
    | 'MuiTableCell'
    | 'MuiPaginationItem'
    | 'MuiSlider',
  key: string,
  theme: Theme,
  ownerState?: ChipOwnerStateArg | OwnerStateArg,
): Record<string, unknown> {
  const componentOverrides = overrides as Record<string, { styleOverrides?: Record<string, StyleFn> } | undefined>;
  const fn = componentOverrides[component]?.styleOverrides?.[key];
  if (typeof fn !== 'function') throw new Error(`${component}.${key} is not a style-override function`);
  return fn({ theme, ownerState });
}

describe('iconButtonDensityOverrides', () => {
  it('writes root/sizeSmall/sizeLarge padding as rem(theme, px) — the literals IconButton.js hard-codes', () => {
    const theme = createTheme();
    const overrides = iconButtonDensityOverrides();
    expect(slot(overrides, 'MuiIconButton', 'root', theme)).toEqual({ padding: theme.typography.pxToRem(8) });
    expect(slot(overrides, 'MuiIconButton', 'sizeSmall', theme)).toEqual({ padding: theme.typography.pxToRem(5) });
    expect(slot(overrides, 'MuiIconButton', 'sizeLarge', theme)).toEqual({ padding: theme.typography.pxToRem(12) });
  });

  it('is a true no-op at the default theme: fontSize is 14, so padding is 0.5rem — 8px at the 16px root', () => {
    const theme = createTheme();
    expect(theme.typography.fontSize).toBe(14);
    const overrides = iconButtonDensityOverrides();
    expect(slot(overrides, 'MuiIconButton', 'root', theme)).toEqual({ padding: '0.5rem' });
    expect(slot(overrides, 'MuiIconButton', 'sizeSmall', theme)).toEqual({ padding: '0.3125rem' });
    expect(slot(overrides, 'MuiIconButton', 'sizeLarge', theme)).toEqual({ padding: '0.75rem' });
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = iconButtonDensityOverrides();
    expect(slot(overrides, 'MuiIconButton', 'root', theme)).toEqual({ padding: '0.45rem' }); // 8 * 0.9 / 16
  });

  it('two separately-built override sets are the SAME function references — required for the two paths to compare equal', () => {
    const a = iconButtonDensityOverrides();
    const b = iconButtonDensityOverrides();
    expect(a.MuiIconButton?.styleOverrides?.root).toBe(b.MuiIconButton?.styleOverrides?.root);
    expect(a).toEqual(b);
  });
});

describe('chipDensityOverrides', () => {
  it('writes root/sizeSmall height and label/labelSmall padding as rem(theme, px)', () => {
    const theme = createTheme();
    const overrides = chipDensityOverrides();
    expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: theme.typography.pxToRem(32) });
    expect(slot(overrides, 'MuiChip', 'sizeSmall', theme)).toEqual({ height: theme.typography.pxToRem(24) });
    expect(slot(overrides, 'MuiChip', 'label', theme)).toEqual({
      paddingLeft: theme.typography.pxToRem(12),
      paddingRight: theme.typography.pxToRem(12),
    });
    expect(slot(overrides, 'MuiChip', 'labelSmall', theme)).toEqual({
      paddingLeft: theme.typography.pxToRem(8),
      paddingRight: theme.typography.pxToRem(8),
    });
  });

  it('is a true no-op at the default theme: fontSize is 14, so height/padding compute to the literals they replace', () => {
    const theme = createTheme();
    const overrides = chipDensityOverrides();
    expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: '2rem' }); // 32px / 16
    expect(slot(overrides, 'MuiChip', 'sizeSmall', theme)).toEqual({ height: '1.5rem' }); // 24px / 16
    expect(slot(overrides, 'MuiChip', 'label', theme)).toEqual({ paddingLeft: '0.75rem', paddingRight: '0.75rem' }); // 12px / 16
    expect(slot(overrides, 'MuiChip', 'labelSmall', theme)).toEqual({ paddingLeft: '0.5rem', paddingRight: '0.5rem' }); // 8px / 16
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = chipDensityOverrides();
    expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: '1.8rem' }); // 32 * 0.9 / 16
    expect(slot(overrides, 'MuiChip', 'sizeSmall', theme)).toEqual({ height: '1.35rem' }); // 24 * 0.9 / 16
  });

  it('two separately-built override sets are the SAME function references — required for the two paths to compare equal', () => {
    const a = chipDensityOverrides();
    const b = chipDensityOverrides();
    expect(a.MuiChip?.styleOverrides?.label).toBe(b.MuiChip?.styleOverrides?.label);
    expect(a).toEqual(b);
  });

  /**
   * FUT-2766 follow-up (adversarial review) — the OUTLINED variant's own
   * label padding (`11`/`7`, ChipLabel's baked-in `variants`, `Chip.js`) is a
   * DIFFERENT number from filled's `12`/`8` and must not be clobbered by the
   * `label`/`labelSmall` overrides above, which apply unconditionally. The
   * fix lives on the ROOT slot (see the module doc comment for why a
   * `components.MuiChip.variants` entry cannot reach the label slot at all).
   */
  describe('the outlined variant keeps its OWN label padding (11/7), not filled its 12/8', () => {
    it('root carries a nested .MuiChip-label rule for outlined, at both sizes, as rem(theme, px)', () => {
      const theme = createTheme();
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined' })).toEqual({
        height: theme.typography.pxToRem(32),
        '& .MuiChip-label': {
          paddingLeft: theme.typography.pxToRem(11),
          paddingRight: theme.typography.pxToRem(11),
        },
      });
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined', size: 'small' })).toEqual({
        height: theme.typography.pxToRem(32),
        '& .MuiChip-label': {
          paddingLeft: theme.typography.pxToRem(7),
          paddingRight: theme.typography.pxToRem(7),
        },
      });
    });

    it('is a true no-op at the default theme: 11px/7px, the exact literals ChipLabel bakes in for outlined', () => {
      const theme = createTheme();
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined' })['& .MuiChip-label']).toEqual({
        paddingLeft: '0.6875rem', // 11px / 16
        paddingRight: '0.6875rem',
      });
      expect(
        slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined', size: 'small' })['& .MuiChip-label'],
      ).toEqual({
        paddingLeft: '0.4375rem', // 7px / 16
        paddingRight: '0.4375rem',
      });
    });

    it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
      const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'outlined' })['& .MuiChip-label']).toEqual({
        paddingLeft: '0.61875rem', // 11 * 0.9 / 16
        paddingRight: '0.61875rem',
      });
    });

    it('a FILLED chip (no variant, or variant: "filled") gets no nested label rule at all — root is just the height', () => {
      const theme = createTheme();
      const overrides = chipDensityOverrides();
      expect(slot(overrides, 'MuiChip', 'root', theme)).toEqual({ height: theme.typography.pxToRem(32) });
      expect(slot(overrides, 'MuiChip', 'root', theme, { variant: 'filled' })).toEqual({
        height: theme.typography.pxToRem(32),
      });
    });
  });
});

describe('toggleButtonDensityOverrides', () => {
  it('writes root/sizeSmall/sizeLarge padding as rem(theme, px) — the literals ToggleButton.js hard-codes', () => {
    const theme = createTheme();
    const overrides = toggleButtonDensityOverrides();
    expect(slot(overrides, 'MuiToggleButton', 'root', theme)).toEqual({ padding: theme.typography.pxToRem(11) });
    expect(slot(overrides, 'MuiToggleButton', 'sizeSmall', theme)).toEqual({ padding: theme.typography.pxToRem(7) });
    expect(slot(overrides, 'MuiToggleButton', 'sizeLarge', theme)).toEqual({ padding: theme.typography.pxToRem(15) });
  });

  it('is a true no-op at the default theme: 11px/7px/15px, the exact literals it replaces', () => {
    const theme = createTheme();
    const overrides = toggleButtonDensityOverrides();
    expect(slot(overrides, 'MuiToggleButton', 'root', theme)).toEqual({ padding: '0.6875rem' }); // 11 / 16
    expect(slot(overrides, 'MuiToggleButton', 'sizeSmall', theme)).toEqual({ padding: '0.4375rem' }); // 7 / 16
    expect(slot(overrides, 'MuiToggleButton', 'sizeLarge', theme)).toEqual({ padding: '0.9375rem' }); // 15 / 16
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = toggleButtonDensityOverrides();
    expect(slot(overrides, 'MuiToggleButton', 'root', theme)).toEqual({ padding: '0.61875rem' }); // 11 * 0.9 / 16
  });

  it('two separately-built override sets are the SAME function references', () => {
    const a = toggleButtonDensityOverrides();
    const b = toggleButtonDensityOverrides();
    expect(a.MuiToggleButton?.styleOverrides?.root).toBe(b.MuiToggleButton?.styleOverrides?.root);
    expect(a).toEqual(b);
  });
});

describe('tabDensityOverrides', () => {
  it('writes root minHeight/padding as rem(theme, px)/rems(theme, 12, 16) — the literals Tab.js hard-codes', () => {
    const theme = createTheme();
    const overrides = tabDensityOverrides();
    expect(slot(overrides, 'MuiTab', 'root', theme)).toEqual({
      minHeight: theme.typography.pxToRem(48),
      padding: `${theme.typography.pxToRem(12)} ${theme.typography.pxToRem(16)}`,
    });
  });

  it('writes labelIcon (the icon+label combo) minHeight/paddingTop/paddingBottom as rem(theme, px)', () => {
    const theme = createTheme();
    const overrides = tabDensityOverrides();
    expect(slot(overrides, 'MuiTab', 'labelIcon', theme)).toEqual({
      minHeight: theme.typography.pxToRem(72),
      paddingTop: theme.typography.pxToRem(9),
      paddingBottom: theme.typography.pxToRem(9),
    });
  });

  it('is a true no-op at the default theme: the exact literals Tab.js hard-codes', () => {
    const theme = createTheme();
    const overrides = tabDensityOverrides();
    expect(slot(overrides, 'MuiTab', 'root', theme)).toEqual({ minHeight: '3rem', padding: '0.75rem 1rem' }); // 48/16, 12/16 16/16
    expect(slot(overrides, 'MuiTab', 'labelIcon', theme)).toEqual({
      minHeight: '4.5rem', // 72 / 16
      paddingTop: '0.5625rem', // 9 / 16
      paddingBottom: '0.5625rem',
    });
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = tabDensityOverrides();
    expect(slot(overrides, 'MuiTab', 'root', theme)).toEqual({ minHeight: '2.7rem', padding: '0.675rem 0.9rem' });
    expect(slot(overrides, 'MuiTab', 'labelIcon', theme)).toEqual({
      minHeight: '4.05rem',
      paddingTop: '0.50625rem',
      paddingBottom: '0.50625rem',
    });
  });

  it('two separately-built override sets are the SAME function references', () => {
    const a = tabDensityOverrides();
    const b = tabDensityOverrides();
    expect(a.MuiTab?.styleOverrides?.labelIcon).toBe(b.MuiTab?.styleOverrides?.labelIcon);
    expect(a).toEqual(b);
  });
});

describe('tabsIndicatorDensityOverrides', () => {
  it('writes indicator HEIGHT for the default (horizontal) orientation as rem(theme, 2) — the literal Tabs.js hard-codes', () => {
    const theme = createTheme();
    const overrides = tabsIndicatorDensityOverrides();
    expect(slot(overrides, 'MuiTabs', 'indicator', theme)).toEqual({ height: theme.typography.pxToRem(2) });
    expect(slot(overrides, 'MuiTabs', 'indicator', theme, { orientation: 'horizontal' })).toEqual({
      height: theme.typography.pxToRem(2),
    });
  });

  /**
   * FUT-2768 — MUI's OWN vertical variant sets `width: 2` and leaves
   * `height: '100%'` (from that SAME variant) alone; an override that wrote
   * BOTH unconditionally would clobber the vertical indicator's full-length
   * axis, the same Lesson-1 clobber the Slider rail override avoids.
   */
  it('writes indicator WIDTH — not height — for a vertical Tabs', () => {
    const theme = createTheme();
    const overrides = tabsIndicatorDensityOverrides();
    expect(slot(overrides, 'MuiTabs', 'indicator', theme, { orientation: 'vertical' })).toEqual({
      width: theme.typography.pxToRem(2),
    });
  });

  it('is a true no-op at the default theme: 2px, the exact literal it replaces', () => {
    const theme = createTheme();
    const overrides = tabsIndicatorDensityOverrides();
    expect(slot(overrides, 'MuiTabs', 'indicator', theme)).toEqual({ height: '0.125rem' }); // 2 / 16
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = tabsIndicatorDensityOverrides();
    expect(slot(overrides, 'MuiTabs', 'indicator', theme)).toEqual({ height: '0.1125rem' }); // 2 * 0.9 / 16
  });

  it('two separately-built override sets are the SAME function references', () => {
    const a = tabsIndicatorDensityOverrides();
    const b = tabsIndicatorDensityOverrides();
    expect(a.MuiTabs?.styleOverrides?.indicator).toBe(b.MuiTabs?.styleOverrides?.indicator);
    expect(a).toEqual(b);
  });
});

describe('tableCellDensityOverrides', () => {
  it('writes root padding as rem(theme, 16) — the literal TableCell.js hard-codes', () => {
    const theme = createTheme();
    const overrides = tableCellDensityOverrides();
    expect(slot(overrides, 'MuiTableCell', 'root', theme)).toEqual({ padding: theme.typography.pxToRem(16) });
    // Same at the explicit default — `undefined` and `'normal'` must agree.
    expect(slot(overrides, 'MuiTableCell', 'root', theme, { padding: 'normal' })).toEqual({
      padding: theme.typography.pxToRem(16),
    });
  });

  /**
   * FUT-2861 adversarial review — a REAL render found `root`'s unconditional
   * padding clobbering `TableCell.js`'s own `checkbox`/`none` variants at the
   * default (medium) size, the SAME Lesson-1 shape the ellipsis fix above
   * exists for, missed here. Both variants keep MUI's own UNSCALED literal —
   * this file writes NOTHING for them, so nothing composes over it.
   */
  it("writes NOTHING for root at padding='checkbox'/'none' — MUI's own unscaled variant must win", () => {
    const theme = createTheme();
    const overrides = tableCellDensityOverrides();
    expect(slot(overrides, 'MuiTableCell', 'root', theme, { padding: 'checkbox' })).toEqual({});
    expect(slot(overrides, 'MuiTableCell', 'root', theme, { padding: 'none' })).toEqual({});
  });

  it('writes sizeSmall padding, and a nested paddingCheckbox rule inside it, as rem(theme, px)', () => {
    const theme = createTheme();
    const overrides = tableCellDensityOverrides();
    expect(slot(overrides, 'MuiTableCell', 'sizeSmall', theme)).toEqual({
      padding: `${theme.typography.pxToRem(6)} ${theme.typography.pxToRem(16)}`,
      '&.MuiTableCell-paddingCheckbox': {
        // `rems()` renders a `0` entry as the bare literal, not `pxToRem(0)`
        // (`'0rem'`) — see `tokens/relative.ts`'s own doc comment.
        padding: `0 ${theme.typography.pxToRem(12)} 0 ${theme.typography.pxToRem(16)}`,
      },
    });
  });

  /**
   * FUT-2861 audit follow-up: `sizeSmall`'s own unconditional `padding` had
   * the SAME clobber for `padding="none"` at `size="small"` — MUI's own
   * `variants` array resolves that combo to `padding: 0` (the `none` entry
   * comes AFTER `size: 'small'`'s in array order), which an unconditional
   * `sizeSmall` rule overrode. The nested checkbox rule stays (harmless — it
   * only matches an element that ALSO carries the checkbox class), but the
   * top-level `padding` key must be absent so MUI's own `0` is not clobbered.
   */
  it("skips the top-level padding at sizeSmall + padding='none' too", () => {
    const theme = createTheme();
    const overrides = tableCellDensityOverrides();
    const result = slot(overrides, 'MuiTableCell', 'sizeSmall', theme, { padding: 'none' });
    expect(result.padding).toBeUndefined();
  });

  it('is a true no-op at the default theme: the exact literals TableCell.js hard-codes', () => {
    const theme = createTheme();
    const overrides = tableCellDensityOverrides();
    expect(slot(overrides, 'MuiTableCell', 'root', theme)).toEqual({ padding: '1rem' }); // 16 / 16
    const small = slot(overrides, 'MuiTableCell', 'sizeSmall', theme);
    expect(small.padding).toBe('0.375rem 1rem'); // '6px 16px'
    expect((small['&.MuiTableCell-paddingCheckbox'] as { padding: string }).padding).toBe('0 0.75rem 0 1rem'); // '0 12px 0 16px'
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = tableCellDensityOverrides();
    expect(slot(overrides, 'MuiTableCell', 'root', theme)).toEqual({ padding: '0.9rem' }); // 16 * 0.9 / 16
  });

  it('two separately-built override sets are the SAME function references', () => {
    const a = tableCellDensityOverrides();
    const b = tableCellDensityOverrides();
    expect(a.MuiTableCell?.styleOverrides?.sizeSmall).toBe(b.MuiTableCell?.styleOverrides?.sizeSmall);
    expect(a).toEqual(b);
  });
});

describe('paginationItemDensityOverrides', () => {
  it('writes root/sizeSmall/sizeLarge minWidth AND height for a page item, as rem(theme, px)', () => {
    const theme = createTheme();
    const overrides = paginationItemDensityOverrides();
    expect(slot(overrides, 'MuiPaginationItem', 'root', theme, { type: 'page' })).toEqual({
      minWidth: theme.typography.pxToRem(32),
      height: theme.typography.pxToRem(32),
    });
    expect(slot(overrides, 'MuiPaginationItem', 'sizeSmall', theme, { type: 'page' })).toEqual({
      minWidth: theme.typography.pxToRem(26),
      height: theme.typography.pxToRem(26),
    });
    expect(slot(overrides, 'MuiPaginationItem', 'sizeLarge', theme, { type: 'page' })).toEqual({
      minWidth: theme.typography.pxToRem(40),
      height: theme.typography.pxToRem(40),
    });
  });

  it('previous/next/first/last items get the SAME geometry as a page item — not just "page"', () => {
    const theme = createTheme();
    const overrides = paginationItemDensityOverrides();
    for (const type of ['previous', 'next', 'first', 'last'] as const) {
      expect(slot(overrides, 'MuiPaginationItem', 'root', theme, { type })).toEqual({
        minWidth: theme.typography.pxToRem(32),
        height: theme.typography.pxToRem(32),
      });
    }
  });

  /**
   * FUT-2768 — the ellipsis (`…`) shares `MuiPaginationItem`'s theme name/slot
   * with the numbered button but draws NO explicit height of its own
   * (`height: 'auto'` in `PaginationItem.js`'s `PaginationItemEllipsis`).
   * Setting an explicit height on it would replace that auto-sized line
   * height with a fixed box — the Lesson-1 clobber this override must not
   * reproduce.
   */
  it('the ellipsis keeps minWidth but gets NO height — it has none of its own to override', () => {
    const theme = createTheme();
    const overrides = paginationItemDensityOverrides();
    expect(slot(overrides, 'MuiPaginationItem', 'root', theme, { type: 'start-ellipsis' })).toEqual({
      minWidth: theme.typography.pxToRem(32),
    });
    expect(slot(overrides, 'MuiPaginationItem', 'root', theme, { type: 'end-ellipsis' })).toEqual({
      minWidth: theme.typography.pxToRem(32),
    });
    expect(slot(overrides, 'MuiPaginationItem', 'sizeSmall', theme, { type: 'start-ellipsis' })).toEqual({
      minWidth: theme.typography.pxToRem(26),
    });
  });

  it('is a true no-op at the default theme: 32px/26px/40px, the exact literals it replaces', () => {
    const theme = createTheme();
    const overrides = paginationItemDensityOverrides();
    expect(slot(overrides, 'MuiPaginationItem', 'root', theme, { type: 'page' })).toEqual({
      minWidth: '2rem', // 32 / 16
      height: '2rem',
    });
    expect(slot(overrides, 'MuiPaginationItem', 'sizeSmall', theme, { type: 'page' })).toEqual({
      minWidth: '1.625rem', // 26 / 16
      height: '1.625rem',
    });
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = paginationItemDensityOverrides();
    expect(slot(overrides, 'MuiPaginationItem', 'root', theme, { type: 'page' })).toEqual({
      minWidth: '1.8rem', // 32 * 0.9 / 16
      height: '1.8rem',
    });
  });

  it('two separately-built override sets are the SAME function references', () => {
    const a = paginationItemDensityOverrides();
    const b = paginationItemDensityOverrides();
    expect(a.MuiPaginationItem?.styleOverrides?.root).toBe(b.MuiPaginationItem?.styleOverrides?.root);
    expect(a).toEqual(b);
  });
});

describe('sliderDensityOverrides', () => {
  it('writes root/sizeSmall HEIGHT for a horizontal slider (the default) as rem(theme, px)', () => {
    const theme = createTheme();
    const overrides = sliderDensityOverrides();
    expect(slot(overrides, 'MuiSlider', 'root', theme)).toEqual({ height: theme.typography.pxToRem(4) });
    expect(slot(overrides, 'MuiSlider', 'root', theme, { orientation: 'horizontal' })).toEqual({
      height: theme.typography.pxToRem(4),
    });
    expect(slot(overrides, 'MuiSlider', 'sizeSmall', theme)).toEqual({ height: theme.typography.pxToRem(2) });
  });

  /**
   * FUT-2768 — MUI's OWN baked-in variant for `orientation: 'vertical'` sets
   * `width: 4` and leaves `height: '100%'` (from that SAME variant) alone; an
   * override that wrote BOTH `height` and `width` unconditionally would
   * clobber the vertical slider's own full-length axis. Confirms the gate.
   */
  it('writes root/sizeSmall WIDTH — not height — for a vertical slider', () => {
    const theme = createTheme();
    const overrides = sliderDensityOverrides();
    expect(slot(overrides, 'MuiSlider', 'root', theme, { orientation: 'vertical' })).toEqual({
      width: theme.typography.pxToRem(4),
    });
    expect(slot(overrides, 'MuiSlider', 'sizeSmall', theme, { orientation: 'vertical' })).toEqual({
      width: theme.typography.pxToRem(2),
    });
  });

  it('writes thumb/thumbSizeSmall width AND height as rem(theme, px) — square at both sizes', () => {
    const theme = createTheme();
    const overrides = sliderDensityOverrides();
    expect(slot(overrides, 'MuiSlider', 'thumb', theme)).toEqual({
      width: theme.typography.pxToRem(20),
      height: theme.typography.pxToRem(20),
    });
    expect(slot(overrides, 'MuiSlider', 'thumbSizeSmall', theme)).toEqual({
      width: theme.typography.pxToRem(12),
      height: theme.typography.pxToRem(12),
    });
  });

  it('is a true no-op at the default theme: the exact literals Slider.js hard-codes', () => {
    const theme = createTheme();
    const overrides = sliderDensityOverrides();
    expect(slot(overrides, 'MuiSlider', 'root', theme)).toEqual({ height: '0.25rem' }); // 4 / 16
    expect(slot(overrides, 'MuiSlider', 'sizeSmall', theme)).toEqual({ height: '0.125rem' }); // 2 / 16
    expect(slot(overrides, 'MuiSlider', 'thumb', theme)).toEqual({ width: '1.25rem', height: '1.25rem' }); // 20/16
    expect(slot(overrides, 'MuiSlider', 'thumbSizeSmall', theme)).toEqual({ width: '0.75rem', height: '0.75rem' }); // 12/16
  });

  it('scales at a compact fontSize (factor 0.9) exactly as far as pxToRem does', () => {
    const theme = createTheme({ typography: { fontSize: densityFontSize(0.9) } });
    const overrides = sliderDensityOverrides();
    expect(slot(overrides, 'MuiSlider', 'root', theme)).toEqual({ height: '0.225rem' }); // 4 * 0.9 / 16
    expect(slot(overrides, 'MuiSlider', 'thumb', theme)).toEqual({ width: '1.125rem', height: '1.125rem' }); // 20*0.9/16
  });

  it('two separately-built override sets are the SAME function references', () => {
    const a = sliderDensityOverrides();
    const b = sliderDensityOverrides();
    expect(a.MuiSlider?.styleOverrides?.thumb).toBe(b.MuiSlider?.styleOverrides?.thumb);
    expect(a).toEqual(b);
  });
});
