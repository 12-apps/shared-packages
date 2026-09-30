import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';

import { Avatar } from '../components/data-display/Avatar/Avatar';
import { Table } from '../components/data-display/Table/Table';
import type { ColumnConfig } from '../components/data-display/Table/Table.types';
import { Slider } from '../components/form/Slider/Slider';
import { Toggle } from '../components/form/Toggle/Toggle';
import { ToggleGroup } from '../components/form/ToggleGroup/ToggleGroup';
import { Pagination } from '../components/navigation/Pagination/Pagination';
import { Tabs } from '../components/navigation/Tabs/Tabs';
import type { TabItem } from '../components/navigation/Tabs/Tabs.types';
import { muiThemeOptionsFrom } from '../provider/mui-bridge';
import { createUiTheme } from './theme';
import type { DensityLevel } from './density.core';

/**
 * FUT-2768 — DOES THE OVERRIDE REACH `@12-apps/ui`'s OWN WRAPPER?
 *
 * `density-overrides.test.stories.tsx` proves the theme overrides against
 * BARE `@mui/material` components. A code-reading claim that a wrapper's own
 * styling "already handles density" or "blocks the override harmlessly" is
 * exactly the FUT-2767 miss (Switch's `sx`-based `translateX(20px)` silently
 * un-scaled): the only way to know which one is true is to render the
 * PRODUCT'S OWN component and measure it, in both directions, which is what
 * this file does for all seven: `Toggle` (wraps `ToggleButton`), `ToggleGroup`
 * (also wraps `ToggleButton`, its own instance, through `sx` rather than
 * `Toggle`), `Tabs` (wraps `Tab`), `Table` (wraps `TableCell`), `Pagination`
 * (wraps `PaginationItem`), `Slider`, `Avatar`.
 *
 * Reading each wrapper's own stylesheet first (`Toggle.styles.ts`,
 * `ToggleGroup.tsx`'s own inline `sizeMap`, `Tabs.styles.ts`,
 * `Table.styles.ts`, `Pagination.styles.ts`, `Slider.styles.ts`,
 * `Avatar.view.tsx`) turned up three different shapes, confirmed here by
 * measurement rather than assumed from the source:
 *
 * - `Toggle`, `ToggleGroup`, `Slider`, `Avatar`: their own size table is
 *   applied UNCONDITIONALLY (every named size, including the default, always
 *   produces a value) — through `rem()`/`rems()`, so they are already
 *   density-aware on their OWN terms, at a DIFFERENT design value than bare
 *   MUI's (`Toggle`/`ToggleGroup` both zero their own top/bottom padding and
 *   draw height from `fieldHeight` instead, keeping only 16px left/right at
 *   md, not MUI's 11px all round — `ToggleGroup` sets this on a raw
 *   `ToggleButton`'s `sx` prop rather than rendering `Toggle`, the SAME
 *   sx-beats-`styleOverrides` shape FUT-2767 found on `Switch`, just already
 *   density-aware where `Switch`'s wasn't; `Slider` md is an 8px track, not
 *   MUI's 4px, and its OWN hover/active/`Mui-focusVisible` thumb ring is
 *   drawn through `rem(theme, 8)` too, independent of
 *   `sliderDensityOverrides` — see that function's own module doc comment for
 *   why the equivalent bare-MUI literal is left unscaled), and blocked from
 *   this file's bare-MUI override by ordinary composition (their
 *   `styled(MuiX, …)`/`sx` wrapper's own declaration wins).
 *   `NormalMatchesEachWrappersOwnDesign`/`CompactScalesEachWrapperByItsOwnRule`
 *   below prove the ×1/×0.9 pair the SAME way this ticket's bare-MUI stories
 *   do.
 * - `Table`: its OWN discrete per-level cell-padding/row-height table
 *   (`Table.styles.ts`), read off its `density` prop (`'normal'` unless the
 *   caller says otherwise — FUT-2886 reverted the from-the-theme default
 *   FUT-2769 gave it), nested two classes deep — higher specificity than this
 *   ticket's single-class `MuiTableCell` override, so it always wins
 *   regardless. Proven again here for the PRODUCT path specifically. `Tabs`'
 *   own INDICATOR is the same shape: its
 *   default (`variant="default"`) styling sets `& .MuiTabs-indicator {
 *   height: rem(theme, 3) }` unconditionally (`Tabs.styles.ts`'s
 *   `compactVariantStyles`), a nested two-class selector that outranks this
 *   ticket's single-class `tabsIndicatorDensityOverrides` the same way —
 *   ALREADY density-aware, at 3px rather than bare MUI's 2px, not a gap.
 * - `Tabs`/`Pagination`: their own size table for `Tab`'s/`PaginationItem`'s
 *   ROOT slot (`Tabs.styles.ts`'s `sizeStyles`, `Pagination.styles.ts`'s
 *   `ITEM_SIZE_STYLES`) is written for `sm`/`lg` ONLY — the DEFAULT size
 *   (`md`, `Tabs`'s and `Pagination`'s own default) resolves to `{}`, so
 *   nothing in the wrapper touches `MuiTab`/`MuiPaginationItem`'s root
 *   geometry at that size (the INDICATOR slot above is a separate story).
 *   This ticket's bare-MUI override THEREFORE REACHES the product's own
 *   default-size `Tabs`/`Pagination` root geometry — a real, positive effect
 *   of this PR: unlike `Toggle`/`ToggleGroup`/`Slider`/`Avatar`/`Tabs`'s own
 *   indicator, these get a real density fix at their most common size, not
 *   just at a bare `@mui/material` call site.
 */

function themeFor(density: DensityLevel) {
  return createTheme(muiThemeOptionsFrom(createUiTheme({ density })));
}

const tableColumns: ColumnConfig[] = [{ key: 'name', label: 'Nome' }];
const tableData = [{ id: 1, name: 'Ana' }];
const tabItems: TabItem[] = [{ id: 'a', label: 'Tab A', content: <div /> }];
const toggleGroupOptions = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

function WrapperReachShowcase({ density }: { density: DensityLevel }) {
  return (
    <ThemeProvider theme={themeFor(density)}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Toggle data-testid="wrap-toggle" value="a">
          Toggle
        </Toggle>

        <ToggleGroup
          options={toggleGroupOptions}
          value="a"
          onChange={() => undefined}
          dataTestId="wrap-togglegroup"
        />

        <Tabs
          closeTabLabel="Fechar"
          items={tabItems}
          value="a"
          onChange={() => undefined}
          dataTestId="wrap-tabs"
        />

        {/* `Table` renders its OWN complete `<table>` — it is not a cell to
            drop into somebody else's row. */}
        <Table emptyText="Nenhum dado" columns={tableColumns} data={tableData} />

        <Pagination
          page={1}
          count={5}
          onChange={() => undefined}
          pageSizeLabel="Itens por página"
          dataTestId="wrap-pagination"
        />

        <div style={{ width: 120 }}>
          <Slider dataTestId="wrap-slider" value={30} onChange={() => undefined} />
        </div>

        <Avatar fallback="AN" dataTestId="wrap-avatar" />
      </div>
    </ThemeProvider>
  );
}

const meta: Meta<typeof WrapperReachShowcase> = {
  title: 'Tokens/Density wrapper reach/Tests',
  component: WrapperReachShowcase,
  parameters: { layout: 'padded', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test'],
};

export default meta;
type Story = StoryObj<typeof meta>;

function computed(el: Element) {
  return globalThis.getComputedStyle(el);
}

const LAYOUT_UNIT = 1 / 64;

function pxNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

function expectPxClose(actual: string, expectedPx: number): void {
  expect(Math.abs(pxNumber(actual) - expectedPx)).toBeLessThanOrEqual(LAYOUT_UNIT);
}

/** Same pattern as `density-overrides.test.stories.tsx`'s own helper — see its doc comment. */
function ringSpreadPx(boxShadow: string): number {
  const match = /0px 0px 0px ([\d.]+)px/.exec(boxShadow);
  if (match === null) throw new Error(`no zero-offset ring shadow found in: "${boxShadow}"`);
  return Number(match[1]);
}

export const NormalMatchesEachWrappersOwnDesign: Story = {
  tags: ['native-skip'],
  render: () => <WrapperReachShowcase density="normal" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Toggle: its OWN md padding — 0 top/bottom (`Toggle.styles.ts`'s
    // `baseStyles` explicitly zeroes those AFTER the size spread; height
    // comes from `minHeight: fieldHeight(...)` instead) and 16px
    // left/right — NOT bare MUI's 11px all round — proving the wrapper's own
    // size table, not this ticket's override, draws it.
    const toggle = computed(canvas.getByTestId('wrap-toggle'));
    expectPxClose(toggle.paddingTop, 0);
    expectPxClose(toggle.paddingLeft, 16);

    // ToggleGroup: the SAME shape, drawn from its OWN inline `sizeMap` on a
    // raw `ToggleButton`'s `sx` (`ToggleGroup.tsx`), not via `Toggle` — this
    // is the wrapper the FUT-2767 review flagged by name (`ToggleButton/
    // ToggleGroup`); proven separately because `sx` reaching the SAME numbers
    // as `Toggle` is a coincidence of the design, not a code-sharing fact.
    const toggleGroupItem = computed(canvas.getByTestId('wrap-togglegroup-item-a'));
    expectPxClose(toggleGroupItem.paddingTop, 0);
    expectPxClose(toggleGroupItem.paddingLeft, 16);

    // Tabs: its own root minHeight is untouched at default size (`sizeStyles`
    // resolves to `{}` for `md`) — MUI's bare Tab default, 48px, is exactly
    // what THIS TICKET's override also writes, so it is pixel-identical
    // either way at normal density; this proves the number, not the source.
    const tab = computed(canvas.getByTestId('wrap-tabs-tab-0'));
    expectPxClose(tab.minHeight, 48);

    // Tabs' own indicator: 3px, its OWN default-variant literal
    // (`Tabs.styles.ts`), NOT bare MUI's 2px this ticket's
    // `tabsIndicatorDensityOverrides` writes — the nested selector wins.
    const tabsIndicator = canvas.getByTestId('wrap-tabs').querySelector('.MuiTabs-indicator');
    if (!tabsIndicator) throw new Error('MuiTabs-indicator not found');
    expectPxClose(computed(tabsIndicator).height, 3);

    // Table: 'normal' is its own density default regardless of the theme
    // (FUT-2886) — 52px row height at this theme's own 'normal' density,
    // unaffected by this ticket.
    const cell = canvas.getAllByRole('cell')[0];
    if (!cell) throw new Error('table cell not found');
    expectPxClose(computed(cell).height, 52);

    // Pagination: its own ITEM_SIZE_STYLES resolves to `{}` at default size
    // too — MUI's bare 32px is what applies, matching this ticket's override
    // at normal density.
    const page = computed(canvas.getByTestId('wrap-pagination-page-1'));
    expectPxClose(page.minWidth, 32);
    expectPxClose(page.height, 32);
    // The product ALWAYS renders MUI's own `variant="outlined"` shape
    // (`Pagination.tsx`'s `PaginationControl`) — the 1px hairline this
    // ticket leaves unscaled, matching `relative.ts`'s own carved-out
    // exception. Proven, not assumed: it stays 1px, not "no border".
    expectPxClose(page.borderTopWidth, 1);

    // Slider: its OWN md geometry — an 8px track, NOT bare MUI's 4px, and a
    // 20px thumb (md's own thumbSizePx, which happens to equal MUI's) — the
    // wrapper's own `sliderSx` always resolves a size, so this ticket's rail
    // override is a no-op HERE specifically (Table's own shape, not a gap).
    const sliderRoot = canvas.getByTestId('wrap-slider-slider');
    const rail = sliderRoot.querySelector('.MuiSlider-rail');
    if (!rail) throw new Error('MuiSlider-rail not found');
    expectPxClose(computed(rail).height, 8);
    const thumb = canvas.getByTestId('wrap-slider-thumb');
    expectPxClose(computed(thumb).width, 20);
    expectPxClose(computed(thumb).height, 20);

    // Slider's own hover/active/`Mui-focusVisible` ring (`Slider.styles.ts`'s
    // `thumbPart`) is drawn through `rem(theme, 8)`, independent of the bare-
    // MUI literal `sliderDensityOverrides` deliberately leaves unscaled (see
    // that function's own doc comment) — 8px here at normal density, proven
    // to SCALE below at compact, unlike the bare-MUI ring.
    // `transition: 'none'` — box-shadow is a TRANSITIONED property here too;
    // see `density-overrides.test.stories.tsx`'s own comment on this.
    thumb.style.transition = 'none';
    thumb.classList.add('Mui-focusVisible');
    expect(Math.abs(ringSpreadPx(computed(thumb).boxShadow) - 8)).toBeLessThanOrEqual(LAYOUT_UNIT);
    thumb.classList.remove('Mui-focusVisible');
    thumb.style.transition = '';

    // Avatar: its own `rem(theme, boxPx('md'))` — 40px, MUI's own literal,
    // via a `styled()` wrapper this ticket correctly ships no override for.
    const avatar = canvas.getByTestId('wrap-avatar');
    expectPxClose(computed(avatar).width, 40);
    expectPxClose(computed(avatar).height, 40);
  },
};

export const CompactScalesEachWrapperByItsOwnRule: Story = {
  tags: ['native-skip'],
  render: () => <WrapperReachShowcase density="compact" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Toggle: 0 top/bottom at every density (explicitly zeroed), 16*0.9
    // left/right — its OWN size table, scaled by the SAME
    // `typography.fontSize` density mechanism this ticket's overrides use,
    // proving it was never blocked, only ALREADY correct.
    const toggle = computed(canvas.getByTestId('wrap-toggle'));
    expectPxClose(toggle.paddingTop, 0);
    expectPxClose(toggle.paddingLeft, 14.4); // 16 * 0.9

    // ToggleGroup: same story as Toggle — its own inline `sizeMap`, scaled by
    // the same mechanism, never reached by `toggleButtonDensityOverrides`.
    const toggleGroupItem = computed(canvas.getByTestId('wrap-togglegroup-item-a'));
    expectPxClose(toggleGroupItem.paddingTop, 0);
    expectPxClose(toggleGroupItem.paddingLeft, 14.4); // 16 * 0.9

    // Tabs: default size has no wrapper rule, so THIS TICKET's override is
    // what shrinks it — 48 * 0.9. A reverted `tabDensityOverrides()` would
    // leave this at 48px unscaled; this is the product-level fail-first case.
    const tab = computed(canvas.getByTestId('wrap-tabs-tab-0'));
    expectPxClose(tab.minHeight, 43.2); // 48 * 0.9

    // Tabs' own indicator: 3 * 0.9 — its own `rem()`-based literal, scaled by
    // the same mechanism, never reached by `tabsIndicatorDensityOverrides`.
    const tabsIndicator = canvas.getByTestId('wrap-tabs').querySelector('.MuiTabs-indicator');
    if (!tabsIndicator) throw new Error('MuiTabs-indicator not found');
    expectPxClose(computed(tabsIndicator).height, 2.7); // 3 * 0.9

    // Table: no `density` prop is passed, so its own discrete density stays
    // 'normal' (52 design px) regardless of the theme (FUT-2886 — reverted
    // FUT-2769's from-the-theme default, which re-picked the DISCRETE 36px
    // compact row here and then scaled it AGAIN by this same theme's
    // `typography.fontSize` factor: 36 * 0.9 = 32.4, a double scale). The
    // theme's factor is now the ONLY thing that still scales it, through the
    // `rem()` a 'normal' row is drawn with: 52 * 0.9 = 46.8.
    // `table-density-theme-default.test.tsx` proves the same rule against
    // jsdom; this proves the PRODUCT path, where `rem()` and this file's own
    // theme construction (`themeFor`, via `createUiTheme`) apply together.
    const cell = canvas.getAllByRole('cell')[0];
    if (!cell) throw new Error('table cell not found');
    expectPxClose(computed(cell).height, 46.8); // 52 * 0.9

    // Pagination: default size has no wrapper rule either — same story as
    // Tabs, this ticket's override is what shrinks it.
    const page = computed(canvas.getByTestId('wrap-pagination-page-1'));
    expectPxClose(page.minWidth, 28.8); // 32 * 0.9
    expectPxClose(page.height, 28.8);
    // The outlined hairline stays 1px at EVERY density — the one literal
    // `relative.ts` documents as exempt, confirmed unscaled here too.
    expectPxClose(page.borderTopWidth, 1);

    // Slider: 8*0.9 track, 20*0.9 thumb — its own size table, scaled by the
    // SAME mechanism, independent of this ticket's (here, unreached) override.
    const sliderRoot = canvas.getByTestId('wrap-slider-slider');
    const rail = sliderRoot.querySelector('.MuiSlider-rail');
    if (!rail) throw new Error('MuiSlider-rail not found');
    expectPxClose(computed(rail).height, 7.2); // 8 * 0.9
    const thumb = canvas.getByTestId('wrap-slider-thumb');
    expectPxClose(computed(thumb).width, 18); // 20 * 0.9
    expectPxClose(computed(thumb).height, 18);

    // The ring SCALES here — 8 * 0.9 = 7.2 — proving `Slider.styles.ts`'s own
    // `rem(theme, 8)` ring was never blocked by the bare-MUI literal this
    // ticket leaves unscaled; it was already density-aware on its own terms.
    thumb.style.transition = 'none';
    thumb.classList.add('Mui-focusVisible');
    expect(Math.abs(ringSpreadPx(computed(thumb).boxShadow) - 7.2)).toBeLessThanOrEqual(LAYOUT_UNIT);
    thumb.classList.remove('Mui-focusVisible');
    thumb.style.transition = '';

    // Avatar: 40 * 0.9 — its own box, scaled by the same mechanism.
    const avatar = canvas.getByTestId('wrap-avatar');
    expectPxClose(computed(avatar).width, 36); // 40 * 0.9
    expectPxClose(computed(avatar).height, 36);
  },
};
