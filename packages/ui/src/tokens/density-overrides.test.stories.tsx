import Chip from '@mui/material/Chip/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import PaginationItem from '@mui/material/PaginationItem/index.js';
import Slider from '@mui/material/Slider/index.js';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import Tab from '@mui/material/Tab/index.js';
import Tabs from '@mui/material/Tabs/index.js';
import TableCell from '@mui/material/TableCell/index.js';
import ToggleButton from '@mui/material/ToggleButton/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';

import { densityThemeOptions } from './density';
import type { DensityLevel } from './density.core';

/**
 * FUT-2766 — `IconButton`/`Chip` geometry, proved at the COMPUTED-PIXEL level
 * in a real browser.
 *
 * `tokens/__tests__/density.test.ts`/`density-overrides.test.ts` already prove
 * the style-object values (`rem(theme, px)`, invoked directly); what jsdom
 * CANNOT prove is that a `rem` string RESOLVES to the same pixels as the
 * literal it replaces — jsdom's `getComputedStyle` does not fully resolve
 * `rem` against the root font-size the way a real layout engine does. This
 * story renders the two components through `densityThemeOptions` (the
 * standalone path; `density.test.ts` already proves the `muiThemeOptionsFrom`
 * path computes byte-identical override objects) and reads real computed
 * `padding`/`height` in Chromium.
 *
 * The default theme's `typography.fontSize` is MUI's own default, 14 — so
 * `rem(theme, 8)` is `pxToRem(8)` = `0.5rem`, which resolves to `8px` at the
 * standard 16px root: geometry-neutral at `density: 'normal'`, byte-for-byte
 * the literal `IconButton`/`Chip` hard-code. At `density: 'compact'` (factor
 * 0.9) every one of these numbers is 0.9× smaller.
 *
 * `expectPxClose` compares the computed length NUMERICALLY, within one
 * Chromium layout-rounding unit (1/64px — its `LayoutUnit` is a fixed-point
 * type at that resolution), rather than by exact string equality: `32 * 0.9`
 * is `28.8`, which is not an exact multiple of 1/64px, so a real layout
 * engine resolves `1.8rem` to the nearest tick it can lay out at — as close
 * as `28.796875px` or as far as a full tick short, never the mathematical
 * product exactly. That is real, deterministic browser behaviour, not
 * flakiness, and this file exists precisely to catch what jsdom cannot;
 * asserting the exact decimal string would fail on that rounding for some
 * numbers and pass for others by chance, depending on which tick they land
 * closest to — not something this story should be asserting about
 * Chromium's rasteriser. `expectPxClose`'s own doc comment has the FUT-2768
 * measurement (`PaginationItem` `size="small"`) that pins the bound at one
 * full unit rather than half.
 *
 * FUT-2768 adds `ToggleButton`/`Tab`/`Tabs`' indicator/`TableCell`/
 * `PaginationItem`/`Slider` to the SAME showcase and the SAME two stories —
 * one render, one `play`, proving all eight components this file now covers
 * (FUT-2766's two plus FUT-2768's six — `Avatar` is a dead no-op for this
 * package's own call sites and is not shipped, see `density-overrides.ts`'s
 * own doc comment) stay geometry-neutral together, the way a real page
 * renders them.
 *
 * This file proves the numbers against BARE `@mui/material` components.
 * Whether each override actually REACHES `@12-apps/ui`'s OWN wrapper around
 * that component (`Toggle`/`ToggleGroup`, `Tabs`, `Table`, `Pagination`,
 * `Slider`, `Avatar`) is a SEPARATE question — a wrapper's own styling can
 * block a theme override harmlessly (already density-aware on its own terms)
 * or leave a real gap for the override to fill, and source-reading alone
 * cannot tell which; `density-wrapper-reach.test.stories.tsx` renders the
 * PRODUCT'S OWN components and measures both directions.
 *
 * **State-dependent literals this file deliberately leaves unscaled**
 * (a FUT-2767-review pass, the same one that added the `Tabs` indicator
 * above): `Slider.js`'s thumb hover/active/`Mui-focusVisible` ring
 * (`boxShadow: '0px 0px 0px 8px rgba(...)'`, replacing the thumb's box-shadow
 * OUTRIGHT for that state, one CSS property with no way to override only the
 * spread) and its value-label position anchor (`top: '-10px'` horizontal,
 * `right: '30px'`/`'20px'` vertical/vertical+small). Scaling the ring would
 * mean re-deriving MUI's own per-palette-colour `alpha()` maths in this file
 * just to change one number in it — far riskier than the padding/size
 * literals this ticket actually ships; the offset is a position anchor MUI
 * itself does not vary by `size` at all except that one vertical+small
 * combo, out of this ticket's own literal catalog. Both are measured, not
 * merely un-overridden, in `NormalIsGeometryNeutral`/`CompactScalesByPoint9`
 * below — proving the decision was checked, not missed.
 */

function themeFor(density: DensityLevel) {
  return createTheme({ palette: { mode: 'light' }, ...densityThemeOptions(density) });
}

function DensityGeometryShowcase({ density }: { density: DensityLevel }) {
  return (
    <ThemeProvider theme={themeFor(density)}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <IconButton data-testid="icon-md" aria-label="medium icon button">
          <span />
        </IconButton>
        <IconButton data-testid="icon-sm" size="small" aria-label="small icon button">
          <span />
        </IconButton>
        <IconButton data-testid="icon-lg" size="large" aria-label="large icon button">
          <span />
        </IconButton>
        <Chip data-testid="chip-md" label="Chip" />
        <Chip data-testid="chip-sm" label="Chip" size="small" />
        <Chip data-testid="chip-md-outlined" label="Chip" variant="outlined" />
        <Chip data-testid="chip-sm-outlined" label="Chip" variant="outlined" size="small" />

        <ToggleButton data-testid="toggle-md" value="md" aria-label="medium toggle">
          <span />
        </ToggleButton>
        <ToggleButton data-testid="toggle-sm" value="sm" size="small" aria-label="small toggle">
          <span />
        </ToggleButton>
        <ToggleButton data-testid="toggle-lg" value="lg" size="large" aria-label="large toggle">
          <span />
        </ToggleButton>

        <Tabs
          data-testid="tabs-root"
          value={0}
          onChange={() => undefined}
          aria-label="density showcase tabs"
        >
          <Tab data-testid="tab-plain" label="Tab" />
          <Tab data-testid="tab-icon-label" icon={<span data-testid="tab-icon-glyph" />} label="Icon tab" />
        </Tabs>

        <table>
          <tbody>
            <tr>
              <TableCell data-testid="cell-default">Default</TableCell>
              <TableCell data-testid="cell-small" size="small">
                Small
              </TableCell>
              <TableCell data-testid="cell-small-checkbox" size="small" padding="checkbox">
                <span />
              </TableCell>
            </tr>
          </tbody>
        </table>

        <ul style={{ display: 'flex', listStyle: 'none', gap: 4, padding: 0, margin: 0 }}>
          <li>
            <PaginationItem data-testid="page-md" type="page" page={1} />
          </li>
          <li>
            <PaginationItem data-testid="page-sm" type="page" page={1} size="small" />
          </li>
          <li>
            <PaginationItem data-testid="page-lg" type="page" page={1} size="large" />
          </li>
          {/* `PaginationItemEllipsis` does not spread `data-testid` (`PaginationItem.js`
              only forwards `...other` to the PAGE branch) — wrap it instead. */}
          <li data-testid="ellipsis-md-wrapper">
            <PaginationItem type="start-ellipsis" />
          </li>
        </ul>

        <div style={{ width: 120 }}>
          <Slider data-testid="slider-md" defaultValue={30} aria-label="medium slider" />
        </div>
        <div style={{ width: 120 }}>
          <Slider data-testid="slider-sm" defaultValue={30} size="small" aria-label="small slider" />
        </div>
        {/* `valueLabelDisplay="on"` forces `.MuiSlider-valueLabel` into the DOM
            without needing a real hover/drag — isolated from `slider-md`/`-sm`
            above so it does not change what those two already assert. */}
        <div style={{ width: 120, paddingTop: 24 }}>
          <Slider
            data-testid="slider-value-label"
            defaultValue={30}
            valueLabelDisplay="on"
            aria-label="slider with a forced value label"
          />
        </div>
      </div>
    </ThemeProvider>
  );
}

const meta: Meta<typeof DensityGeometryShowcase> = {
  title: 'Tokens/Density overrides/Tests',
  component: DensityGeometryShowcase,
  tags: ['test'],
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: true },
  },
};
export default meta;

type Story = StoryObj<typeof meta>;

const computed = (el: Element): CSSStyleDeclaration => globalThis.getComputedStyle(el);

const labelOf = (chip: Element): HTMLElement => {
  const label = chip.querySelector('.MuiChip-label');
  if (label === null) throw new Error('MuiChip-label not found');
  return label as HTMLElement;
};

/**
 * `PaginationItemEllipsis` does not forward `data-testid` — `PaginationItem.js`
 * only spreads `...other` onto the PAGE branch (`PaginationItemPage`), not the
 * ellipsis one — so the ellipsis is found by its own class, inside a wrapper
 * `<li>` that DOES carry the test id.
 */
const ellipsisOf = (wrapper: Element): HTMLElement => {
  const item = wrapper.querySelector('.MuiPaginationItem-root');
  if (item === null) throw new Error('MuiPaginationItem-root (ellipsis) not found');
  return item as HTMLElement;
};

/** Chromium's own layout-rounding unit (`LayoutUnit`, fixed-point at 1/64px). */
const LAYOUT_UNIT = 1 / 64;

function pxNumber(value: string): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (match === null) throw new Error(`not a px length: "${value}"`);
  return Number(match[1]);
}

/**
 * The thumb's hover/active/`Mui-focusVisible` ring is `boxShadow: '0px 0px 0px
 * Npx rgba(...)'` — REPLACING the thumb's box-shadow outright for that state
 * (`Slider.js`'s own per-colour `variants` entry), not composed with anything
 * else on the SAME element (the resting-state elevation shadow lives on
 * `::before`, a different box) — so the zero-offset, zero-blur shape is found
 * directly rather than assumed to be the only shadow layer.
 */
function ringSpreadPx(boxShadow: string): number {
  const match = /0px 0px 0px ([\d.]+)px/.exec(boxShadow);
  if (match === null) throw new Error(`no zero-offset ring shadow found in: "${boxShadow}"`);
  return Number(match[1]);
}

/**
 * A computed px length is within one layout-rounding unit of `expectedPx` —
 * see the module doc comment for why exact string equality is the wrong tool
 * for a value real layout can round (`28.8` → `28.796875`).
 *
 * FUT-2768 found this needs the FULL unit, not half: `PaginationItem`
 * `size="small"` at `density: 'compact'` (`26 * 0.9 = 23.4`) lays out at
 * `23.390625px` — a full `1/64px` short of the mathematical product, not the
 * "nearest tick" a half-unit tolerance assumes. `padding` (a specified value)
 * comes back from `getComputedStyle` verbatim, unrounded; it is `height`/
 * `minHeight`/`minWidth` — resolved through real box-model layout, on an
 * element with its own border/line-height stack — that can land on either
 * side of a tick, so the wider bound covers both without weakening what a
 * PASSING assertion means: at these magnitudes (tens of px) one `1/64px` is
 * roughly 0.05% of the value, well under anything visible.
 */
function expectPxClose(actual: string, expectedPx: number): void {
  expect(Math.abs(pxNumber(actual) - expectedPx)).toBeLessThanOrEqual(LAYOUT_UNIT);
}

export const NormalIsGeometryNeutral: Story = {
  args: { density: 'normal' },
  // MUI's `IconButton`/`Chip` are web-only (`@mui/material`, not
  // react-native-web) and the assertions read `getComputedStyle`/query a DOM
  // class (`.MuiChip-label`) directly — the native test-runner excludes it,
  // the same convention every other DOM-only test story in this package uses.
  tags: ['native-skip'],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // IconButton: 8px (medium/root, the default), 5px (small), 12px (large) —
    // MUI's own literals, unchanged.
    const iconMd = computed(canvas.getByTestId('icon-md'));
    expectPxClose(iconMd.paddingTop, 8);
    expectPxClose(iconMd.paddingLeft, 8);

    const iconSm = computed(canvas.getByTestId('icon-sm'));
    expectPxClose(iconSm.paddingTop, 5);

    const iconLg = computed(canvas.getByTestId('icon-lg'));
    expectPxClose(iconLg.paddingTop, 12);

    // Chip: 32px/24px height (medium/small), 12px/8px label padding.
    const chipMd = canvas.getByTestId('chip-md');
    expectPxClose(computed(chipMd).height, 32);
    const labelMd = computed(labelOf(chipMd));
    expectPxClose(labelMd.paddingLeft, 12);
    expectPxClose(labelMd.paddingRight, 12);

    const chipSm = canvas.getByTestId('chip-sm');
    expectPxClose(computed(chipSm).height, 24);
    const labelSm = computed(labelOf(chipSm));
    expectPxClose(labelSm.paddingLeft, 8);
    expectPxClose(labelSm.paddingRight, 8);

    // Outlined Chip: label padding is 11px/7px (medium/small) — ONE px
    // tighter than filled's 12px/8px, MUI's own literal for the variant
    // (`ChipLabel`'s baked-in `variants`, `Chip.js`) — and must NOT collapse
    // to filled's numbers (the bug an earlier revision of this file had).
    const chipMdOutlined = canvas.getByTestId('chip-md-outlined');
    const labelMdOutlined = computed(labelOf(chipMdOutlined));
    expectPxClose(labelMdOutlined.paddingLeft, 11);
    expectPxClose(labelMdOutlined.paddingRight, 11);

    const chipSmOutlined = canvas.getByTestId('chip-sm-outlined');
    const labelSmOutlined = computed(labelOf(chipSmOutlined));
    expectPxClose(labelSmOutlined.paddingLeft, 7);
    expectPxClose(labelSmOutlined.paddingRight, 7);

    // ToggleButton: 11px/7px/15px (medium/small/large) — MUI's own literals.
    expectPxClose(computed(canvas.getByTestId('toggle-md')).paddingTop, 11);
    expectPxClose(computed(canvas.getByTestId('toggle-sm')).paddingTop, 7);
    expectPxClose(computed(canvas.getByTestId('toggle-lg')).paddingTop, 15);

    // Tab: minHeight 48px, padding '12px 16px'; the icon+label tab is the
    // TALLER 72px/9px-top-bottom box, MUI's own baked-in combo.
    const tabPlain = computed(canvas.getByTestId('tab-plain'));
    expectPxClose(tabPlain.minHeight, 48);
    expectPxClose(tabPlain.paddingTop, 12);
    expectPxClose(tabPlain.paddingLeft, 16);
    const tabIconLabel = computed(canvas.getByTestId('tab-icon-label'));
    expectPxClose(tabIconLabel.minHeight, 72);
    expectPxClose(tabIconLabel.paddingTop, 9);
    expectPxClose(tabIconLabel.paddingBottom, 9);

    // Tabs indicator: 2px thick, MUI's own literal (`Tabs.js`'s `TabsIndicator`).
    const tabsIndicator = canvas.getByTestId('tabs-root').querySelector('.MuiTabs-indicator');
    if (tabsIndicator === null) throw new Error('MuiTabs-indicator not found');
    expectPxClose(computed(tabsIndicator).height, 2);

    // TableCell: 16px default, '6px 16px' at small, '0 12px 0 16px' on the
    // small+checkbox combo.
    const cellDefault = computed(canvas.getByTestId('cell-default'));
    expectPxClose(cellDefault.paddingTop, 16);
    expectPxClose(cellDefault.paddingLeft, 16);
    const cellSmall = computed(canvas.getByTestId('cell-small'));
    expectPxClose(cellSmall.paddingTop, 6);
    expectPxClose(cellSmall.paddingLeft, 16);
    const cellSmallCheckbox = computed(canvas.getByTestId('cell-small-checkbox'));
    expectPxClose(cellSmallCheckbox.paddingTop, 0);
    expectPxClose(cellSmallCheckbox.paddingRight, 12);
    expectPxClose(cellSmallCheckbox.paddingBottom, 0);
    expectPxClose(cellSmallCheckbox.paddingLeft, 16);

    // PaginationItem: 32px/26px/40px minWidth+height (medium/small/large).
    const pageMd = computed(canvas.getByTestId('page-md'));
    expectPxClose(pageMd.minWidth, 32);
    expectPxClose(pageMd.height, 32);
    const pageSm = computed(canvas.getByTestId('page-sm'));
    expectPxClose(pageSm.minWidth, 26);
    expectPxClose(pageSm.height, 26);
    const pageLg = computed(canvas.getByTestId('page-lg'));
    expectPxClose(pageLg.minWidth, 40);
    expectPxClose(pageLg.height, 40);

    // The ellipsis shares minWidth with a page item but keeps its OWN `auto`
    // height (`PaginationItem.js`'s `PaginationItemEllipsis`) — not forced to
    // 32px, the Lesson-1 clobber this override must not reproduce.
    const ellipsis = computed(ellipsisOf(canvas.getByTestId('ellipsis-md-wrapper')));
    expectPxClose(ellipsis.minWidth, 32);
    expect(Math.abs(pxNumber(ellipsis.height) - 32)).toBeGreaterThan(2);

    // Slider: rail 4px/2px thick (medium/small — read off `.MuiSlider-rail`,
    // which computes its OWN height from the root's via `height: 'inherit'`),
    // thumb 20×20/12×12.
    const sliderMd = canvas.getByTestId('slider-md');
    const railMd = sliderMd.querySelector('.MuiSlider-rail');
    if (railMd === null) throw new Error('MuiSlider-rail not found');
    expectPxClose(computed(railMd).height, 4);
    const thumbMd = sliderMd.querySelector('.MuiSlider-thumb');
    if (thumbMd === null) throw new Error('MuiSlider-thumb not found');
    expectPxClose(computed(thumbMd).width, 20);
    expectPxClose(computed(thumbMd).height, 20);

    // Thumb ring, deliberately NOT scaled — `.Mui-focusVisible` is a real
    // class MUI itself toggles on interaction; setting it directly reads the
    // same CSS rule without needing a trusted pointer event (this is a state
    // CHECK, not an interaction-order fix — the trusted-input rule in
    // AGENT-RULES.md is about event/microtask ordering, not about this).
    // `box-shadow` is a TRANSITIONED property (`Slider.js`'s own
    // `transitions.create(['box-shadow', ...])`) — reading it synchronously
    // right after the class change would catch the transition's START value
    // (the old one), not its target, so the inline `transition: 'none'`
    // (higher specificity than the class-based rule) removes the animation
    // for this one read.
    (thumbMd as HTMLElement).style.transition = 'none';
    thumbMd.classList.add('Mui-focusVisible');
    expect(ringSpreadPx(computed(thumbMd).boxShadow)).toBe(8);
    thumbMd.classList.remove('Mui-focusVisible');
    (thumbMd as HTMLElement).style.transition = '';

    // Value-label offset, also deliberately NOT scaled — MUI's own position
    // anchor for the bubble above the thumb, forced into the DOM by
    // `valueLabelDisplay="on"` (`slider-value-label`, no drag needed).
    const valueLabel = canvas.getByTestId('slider-value-label').querySelector('.MuiSlider-valueLabel');
    if (valueLabel === null) throw new Error('MuiSlider-valueLabel not found');
    expectPxClose(computed(valueLabel).top, -10);

    const sliderSm = canvas.getByTestId('slider-sm');
    const railSm = sliderSm.querySelector('.MuiSlider-rail');
    if (railSm === null) throw new Error('MuiSlider-rail not found');
    expectPxClose(computed(railSm).height, 2);
    const thumbSm = sliderSm.querySelector('.MuiSlider-thumb');
    if (thumbSm === null) throw new Error('MuiSlider-thumb not found');
    expectPxClose(computed(thumbSm).width, 12);
    expectPxClose(computed(thumbSm).height, 12);
  },
};

export const CompactScalesByPoint9: Story = {
  args: { density: 'compact' },
  tags: ['native-skip'],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Every number above × 0.9 — child 1's confirmed compact factor.
    const iconMd = computed(canvas.getByTestId('icon-md'));
    expectPxClose(iconMd.paddingTop, 7.2); // 8 * 0.9
    expectPxClose(iconMd.paddingLeft, 7.2);

    const iconSm = computed(canvas.getByTestId('icon-sm'));
    expectPxClose(iconSm.paddingTop, 4.5); // 5 * 0.9

    const iconLg = computed(canvas.getByTestId('icon-lg'));
    expectPxClose(iconLg.paddingTop, 10.8); // 12 * 0.9

    const chipMd = canvas.getByTestId('chip-md');
    expectPxClose(computed(chipMd).height, 28.8); // 32 * 0.9
    const labelMd = computed(labelOf(chipMd));
    expectPxClose(labelMd.paddingLeft, 10.8); // 12 * 0.9
    expectPxClose(labelMd.paddingRight, 10.8);

    const chipSm = canvas.getByTestId('chip-sm');
    expectPxClose(computed(chipSm).height, 21.6); // 24 * 0.9
    const labelSm = computed(labelOf(chipSm));
    expectPxClose(labelSm.paddingLeft, 7.2); // 8 * 0.9
    expectPxClose(labelSm.paddingRight, 7.2);

    // Outlined Chip: 11px/7px × 0.9, same as every other number here.
    const chipMdOutlined = canvas.getByTestId('chip-md-outlined');
    const labelMdOutlined = computed(labelOf(chipMdOutlined));
    expectPxClose(labelMdOutlined.paddingLeft, 9.9); // 11 * 0.9
    expectPxClose(labelMdOutlined.paddingRight, 9.9);

    const chipSmOutlined = canvas.getByTestId('chip-sm-outlined');
    const labelSmOutlined = computed(labelOf(chipSmOutlined));
    expectPxClose(labelSmOutlined.paddingLeft, 6.3); // 7 * 0.9
    expectPxClose(labelSmOutlined.paddingRight, 6.3);

    // ToggleButton
    expectPxClose(computed(canvas.getByTestId('toggle-md')).paddingTop, 9.9); // 11 * 0.9
    expectPxClose(computed(canvas.getByTestId('toggle-sm')).paddingTop, 6.3); // 7 * 0.9
    expectPxClose(computed(canvas.getByTestId('toggle-lg')).paddingTop, 13.5); // 15 * 0.9

    // Tab
    const tabPlain = computed(canvas.getByTestId('tab-plain'));
    expectPxClose(tabPlain.minHeight, 43.2); // 48 * 0.9
    expectPxClose(tabPlain.paddingTop, 10.8); // 12 * 0.9
    expectPxClose(tabPlain.paddingLeft, 14.4); // 16 * 0.9
    const tabIconLabel = computed(canvas.getByTestId('tab-icon-label'));
    expectPxClose(tabIconLabel.minHeight, 64.8); // 72 * 0.9
    expectPxClose(tabIconLabel.paddingTop, 8.1); // 9 * 0.9
    expectPxClose(tabIconLabel.paddingBottom, 8.1);

    // Tabs indicator
    const tabsIndicator = canvas.getByTestId('tabs-root').querySelector('.MuiTabs-indicator');
    if (tabsIndicator === null) throw new Error('MuiTabs-indicator not found');
    expectPxClose(computed(tabsIndicator).height, 1.8); // 2 * 0.9

    // TableCell
    const cellDefault = computed(canvas.getByTestId('cell-default'));
    expectPxClose(cellDefault.paddingTop, 14.4); // 16 * 0.9
    expectPxClose(cellDefault.paddingLeft, 14.4);
    const cellSmall = computed(canvas.getByTestId('cell-small'));
    expectPxClose(cellSmall.paddingTop, 5.4); // 6 * 0.9
    expectPxClose(cellSmall.paddingLeft, 14.4); // 16 * 0.9
    const cellSmallCheckbox = computed(canvas.getByTestId('cell-small-checkbox'));
    expectPxClose(cellSmallCheckbox.paddingTop, 0);
    expectPxClose(cellSmallCheckbox.paddingRight, 10.8); // 12 * 0.9
    expectPxClose(cellSmallCheckbox.paddingBottom, 0);
    expectPxClose(cellSmallCheckbox.paddingLeft, 14.4); // 16 * 0.9

    // PaginationItem
    const pageMd = computed(canvas.getByTestId('page-md'));
    expectPxClose(pageMd.minWidth, 28.8); // 32 * 0.9
    expectPxClose(pageMd.height, 28.8);
    const pageSm = computed(canvas.getByTestId('page-sm'));
    expectPxClose(pageSm.minWidth, 23.4); // 26 * 0.9
    expectPxClose(pageSm.height, 23.4);
    const pageLg = computed(canvas.getByTestId('page-lg'));
    expectPxClose(pageLg.minWidth, 36); // 40 * 0.9
    expectPxClose(pageLg.height, 36);
    const ellipsis = computed(ellipsisOf(canvas.getByTestId('ellipsis-md-wrapper')));
    expectPxClose(ellipsis.minWidth, 28.8); // 32 * 0.9
    expect(Math.abs(pxNumber(ellipsis.height) - 28.8)).toBeGreaterThan(2);

    // Slider
    const sliderMd = canvas.getByTestId('slider-md');
    const railMd = sliderMd.querySelector('.MuiSlider-rail');
    if (railMd === null) throw new Error('MuiSlider-rail not found');
    expectPxClose(computed(railMd).height, 3.6); // 4 * 0.9
    const thumbMd = sliderMd.querySelector('.MuiSlider-thumb');
    if (thumbMd === null) throw new Error('MuiSlider-thumb not found');
    expectPxClose(computed(thumbMd).width, 18); // 20 * 0.9
    expectPxClose(computed(thumbMd).height, 18);

    // Ring/value-label: STILL 8px/-10px at `compact` — the point of these two
    // assertions is that they do NOT move with density, unlike everything
    // else in this story. `transition: 'none'` for the same reason as the
    // Normal story above.
    (thumbMd as HTMLElement).style.transition = 'none';
    thumbMd.classList.add('Mui-focusVisible');
    expect(ringSpreadPx(computed(thumbMd).boxShadow)).toBe(8);
    thumbMd.classList.remove('Mui-focusVisible');
    (thumbMd as HTMLElement).style.transition = '';

    const valueLabel = canvas.getByTestId('slider-value-label').querySelector('.MuiSlider-valueLabel');
    if (valueLabel === null) throw new Error('MuiSlider-valueLabel not found');
    expectPxClose(computed(valueLabel).top, -10);

    const sliderSm = canvas.getByTestId('slider-sm');
    const railSm = sliderSm.querySelector('.MuiSlider-rail');
    if (railSm === null) throw new Error('MuiSlider-rail not found');
    expectPxClose(computed(railSm).height, 1.8); // 2 * 0.9
    const thumbSm = sliderSm.querySelector('.MuiSlider-thumb');
    if (thumbSm === null) throw new Error('MuiSlider-thumb not found');
    expectPxClose(computed(thumbSm).width, 10.8); // 12 * 0.9
    expectPxClose(computed(thumbSm).height, 10.8);
  },
};
