import Chip from '@mui/material/Chip/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
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
 * `expectPxClose` compares the computed length NUMERICALLY, within half of
 * Chromium's own layout-rounding unit (1/64px — its `LayoutUnit` is a
 * fixed-point type at that resolution), rather than by exact string equality:
 * `32 * 0.9` is `28.8`, which is not an exact multiple of 1/64px, so a real
 * layout engine resolves `1.8rem` to the NEAREST 1/64px — `28.796875px` —
 * never the mathematical product. That is real, deterministic browser
 * behaviour, not flakiness, and this file exists precisely to catch what
 * jsdom cannot; asserting the exact decimal string would fail on that
 * rounding for some numbers (`28.8`) and pass for others (`7.2`) by chance,
 * depending on which multiple of 1/64 they land closest to — not something
 * this story should be asserting about Chromium's rasteriser.
 */

function themeFor(density: DensityLevel) {
  return createTheme({ palette: { mode: 'light' }, ...densityThemeOptions(density) });
}

function DensityGeometryShowcase({ density }: { density: DensityLevel }) {
  return (
    <ThemeProvider theme={themeFor(density)}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
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

/** Chromium's own layout-rounding unit (`LayoutUnit`, fixed-point at 1/64px). */
const LAYOUT_UNIT = 1 / 64;

function pxNumber(value: string): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (match === null) throw new Error(`not a px length: "${value}"`);
  return Number(match[1]);
}

/**
 * A computed px length is within half a layout-rounding unit of `expectedPx`
 * — see the module doc comment for why exact string equality is the wrong
 * tool for a value real layout can round (`28.8` → `28.796875`).
 */
function expectPxClose(actual: string, expectedPx: number): void {
  expect(Math.abs(pxNumber(actual) - expectedPx)).toBeLessThanOrEqual(LAYOUT_UNIT / 2);
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
  },
};
