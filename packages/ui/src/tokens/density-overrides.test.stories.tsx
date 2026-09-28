import Checkbox from '@mui/material/Checkbox/index.js';
import Chip from '@mui/material/Chip/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Radio from '@mui/material/Radio/index.js';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import Switch from '@mui/material/Switch/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';

import { densityThemeOptions } from './density';
import type { DensityLevel } from './density.core';
import { Checkbox as UiCheckbox } from '../components/form/Checkbox/Checkbox';
import { RadioGroup as UiRadioGroup } from '../components/form/RadioGroup/RadioGroup';
import { Switch as UiSwitch } from '../components/form/Switch/Switch';

/**
 * FUT-2766/FUT-2767 — `IconButton`/`Chip`/`Checkbox`/`Radio`/`Switch`
 * geometry, proved at the COMPUTED-PIXEL level in a real browser.
 *
 * `tokens/__tests__/density.test.ts`/`density-overrides.test.ts` already prove
 * the style-object values (`rem(theme, px)`, invoked directly); what jsdom
 * CANNOT prove is that a `rem` string RESOLVES to the same pixels as the
 * literal it replaces — jsdom's `getComputedStyle` does not fully resolve
 * `rem` against the root font-size the way a real layout engine does. This
 * story renders every density-overridden component through
 * `densityThemeOptions` (the standalone path; `density.test.ts` already
 * proves the `muiThemeOptionsFrom` path computes byte-identical override
 * objects) and reads real computed `padding`/`height`/`width` in Chromium.
 *
 * The default theme's `typography.fontSize` is MUI's own default, 14 — so
 * `rem(theme, 8)` is `pxToRem(8)` = `0.5rem`, which resolves to `8px` at the
 * standard 16px root: geometry-neutral at `density: 'normal'`, byte-for-byte
 * the literal `IconButton`/`Chip`/`Checkbox`/`Radio`/`Switch` hard-code. At
 * `density: 'compact'` (factor 0.9) every one of these numbers is 0.9×
 * smaller.
 *
 * `expectPxClose` compares the computed length NUMERICALLY, within one unit
 * of Chromium's own layout-rounding unit (1/64px — its `LayoutUnit` is a
 * fixed-point type at that resolution), rather than by exact string equality:
 * `32 * 0.9` is `28.8`, which is not an exact multiple of 1/64px, so a real
 * layout engine's `width`/`height` (CSSOM's "used value", which layout, not
 * plain arithmetic, resolves) FLOORS to the ENCLOSING 1/64px multiple —
 * `28.796875px` — never the mathematical product, and NOT the nearest
 * multiple either (FUT-2767 found a case where the floor and the nearest
 * multiple disagree, `expectPxClose`'s own doc comment has the isolated
 * proof). That is real, deterministic browser behaviour, not flakiness, and
 * this file exists precisely to catch what jsdom cannot; asserting the exact
 * decimal string would fail on that rounding for some numbers (`28.8`) and
 * pass for others (`7.2`, an exact multiple already) by chance, and a
 * symmetric half-unit tolerance is unsound for a FLOOR (see `expectPxClose`).
 * `padding`/`margin` are CSSOM's plain "computed value" instead — an
 * absolute length with no layout step — so every padding assertion below
 * still goes through `expectPxClose`, but the real Chromium number it reads
 * is the exact, un-rounded px (a probe confirms it: an isolated `<span
 * style="padding: 0.45rem">` reports back `7.2px`, not a floored neighbour),
 * so it passes at zero difference rather than needing the tolerance at all.
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
        <Chip data-testid="chip-md-outlined" label="Chip" variant="outlined" />
        <Chip data-testid="chip-sm-outlined" label="Chip" variant="outlined" size="small" />
        {/* `data-testid` is not on `CheckboxProps`/`RadioProps`/`SwitchProps`
            (they type through `SwitchBaseProps`, which does not carry
            arbitrary DOM attributes — the same reason this package's OWN
            `Switch.test.tsx` casts `inputProps` for it) — a wrapping `span`
            gives the test a stable hook instead. */}
        <span data-testid="checkbox-md">
          <Checkbox aria-label="medium checkbox" />
        </span>
        <span data-testid="checkbox-sm">
          <Checkbox size="small" aria-label="small checkbox" />
        </span>
        <span data-testid="radio-md">
          <Radio aria-label="medium radio" />
        </span>
        <span data-testid="radio-sm">
          <Radio size="small" aria-label="small radio" />
        </span>
        <span data-testid="switch-md">
          <Switch aria-label="medium switch" />
        </span>
        <span data-testid="switch-sm">
          <Switch size="small" aria-label="small switch" />
        </span>
        {/* CHECKED (blocking issue 1): `Switch.js` bakes the checked thumb's
            OWN offset (`translateX(20px)`/`translateX(16px)`) into a bare
            literal never run through `pxToRem` — the flat/nested `padding`
            fixes above do not exercise it at all. `checked`/no `onChange` is
            an established pattern in this package's own `Switch.test.stories
            .tsx` for a static, uncontrolled snapshot. */}
        <span data-testid="switch-md-checked">
          <Switch checked aria-label="checked medium switch" />
        </span>
        <span data-testid="switch-sm-checked">
          <Switch size="small" checked aria-label="checked small switch" />
        </span>
        {/* `@12-apps/ui`'s OWN wrappers (blocking issue 2) — Checkbox/
            RadioGroup forward geometry straight to MUI (confirmed in
            `density-overrides.ts`'s module doc comment), so this file's
            theme override reaches them the same as the raw `Checkbox`/
            `Radio` above; Switch draws its OWN geometry per instance,
            already through `rem()`, so `switchDensityOverrides()` never
            reaches it AT ALL — it already scales on its own, including its
            own checked thumb offset. `dataTestId` on `Checkbox`/`RadioGroup`
            lands directly on `.MuiCheckbox-root`/`.MuiRadio-root`; on
            `Switch` it lands on the hidden `<input>` (see `Switch.parts.tsx`),
            so `uiSwitchRootFor` below walks up to `.MuiSwitch-root`. */}
        <UiCheckbox dataTestId="ui-checkbox" aria-label="ui checkbox" />
        <UiRadioGroup dataTestId="ui-radio-group" options={[{ value: 'a', label: 'A' }]} />
        <UiSwitch dataTestId="ui-switch-md" aria-label="ui medium switch" />
        <UiSwitch dataTestId="ui-switch-md-checked" checked aria-label="ui medium switch checked" />
        <UiSwitch size="sm" dataTestId="ui-switch-sm" aria-label="ui small switch" />
        <UiSwitch size="sm" dataTestId="ui-switch-sm-checked" checked aria-label="ui small switch checked" />
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

function querySlot(root: Element, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (el === null) throw new Error(`${selector} not found`);
  return el as HTMLElement;
}

const switchBaseOf = (sw: Element): HTMLElement => querySlot(sw, '.MuiSwitch-switchBase');
const thumbOf = (sw: Element): HTMLElement => querySlot(sw, '.MuiSwitch-thumb');
const checkboxRootIn = (wrapper: Element): HTMLElement => querySlot(wrapper, '.MuiCheckbox-root');
const radioRootIn = (wrapper: Element): HTMLElement => querySlot(wrapper, '.MuiRadio-root');
const switchRootIn = (wrapper: Element): HTMLElement => querySlot(wrapper, '.MuiSwitch-root');

/** Chromium's own layout-rounding unit (`LayoutUnit`, fixed-point at 1/64px). */
const LAYOUT_UNIT = 1 / 64;

function pxNumber(value: string): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (match === null) throw new Error(`not a px length: "${value}"`);
  return Number(match[1]);
}

/**
 * A computed px length is within one layout-rounding unit of `expectedPx` —
 * see the module doc comment for why exact string equality is the wrong tool
 * for a value real layout can round, and why the tolerance is a FULL
 * `LayoutUnit`, not half of one (a correction, empirically driven, over this
 * file's original half-unit tolerance — see FUT-2767's own addition below).
 *
 * `padding`/`margin` are unaffected (CSSOM's plain "computed value" — an
 * absolute length, reported exactly, no layout involved): every padding
 * assertion in this file compares EXACT, not through this helper at all,
 * because a probe (`getComputedStyle` on an isolated `<span style="padding:
 * 0.45rem">`) reads back the full, un-rounded `7.2px` — proving `padding`
 * needs no tolerance at all. `width`/`height` are CSSOM's "used value" —
 * defined to require layout — and a probe of an ISOLATED `<span style="width:
 * 14.4px">` (no theme, no `rem`, a value that cannot itself carry rounding
 * error) still renders at `14.390625px` (`921/64`), never `14.40625px`
 * (`922/64`, the NEARER 1/64 multiple) — proving Chromium's `LayoutUnit`
 * conversion for a used `width`/`height` FLOORS to the ENCLOSING 1/64
 * multiple, it does not round to the nearest one. A floor's error ranges
 * over the WHOLE unit, `[0, 1/64)`, not `[0, 1/128]`, so a symmetric
 * half-unit tolerance is provably unsound for this mechanism — it is not a
 * looser bar chosen for convenience, it is the bar the actual, measured
 * behaviour requires.
 */
function expectPxClose(actual: string, expectedPx: number): void {
  expect(Math.abs(pxNumber(actual) - expectedPx)).toBeLessThan(LAYOUT_UNIT);
}

/**
 * `@12-apps/ui`'s own `<Switch>` `dataTestId` lands on the hidden `<input>`
 * (`Switch.parts.tsx`'s `SwitchControl`), not the root — walk up to the root
 * MUI itself renders through, the same element `switchRootIn`/`switchBaseOf`/
 * `thumbOf` already query for the raw `<Switch>` above.
 */
function uiSwitchRootFor(canvas: ReturnType<typeof within>, testId: string): HTMLElement {
  const input = canvas.getByTestId(testId);
  const root = input.closest('.MuiSwitch-root');
  if (root === null) throw new Error(`${testId}: no .MuiSwitch-root ancestor`);
  return root as HTMLElement;
}

/**
 * The CHECKED thumb's own gap from the track's right (inner) edge —
 * `getBoundingClientRect` on both, not a `transform` string compare, because
 * what a caller's pointer lands on is real, laid-out geometry, not CSS text.
 * By design (both raw MUI and `@12-apps/ui`'s own `Switch`) this gap equals
 * the switchBase's OWN padding at that size/density — the SAME inset the
 * thumb rests at from the TRACK's left edge when unchecked, mirrored: proven
 * once analytically in the FUT-2767 doc comment, and here at the pixel level.
 * A derived (subtracted) length compounds TWO independently-rounded
 * `LayoutUnit` quantisations, so its own tolerance is double `expectPxClose`'s
 * single-measurement one.
 */
function checkedGapFromRight(track: Element, thumb: Element): number {
  return track.getBoundingClientRect().right - thumb.getBoundingClientRect().right;
}

function expectGapClose(actualPx: number, expectedPx: number): void {
  expect(Math.abs(actualPx - expectedPx)).toBeLessThan(2 * LAYOUT_UNIT);
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

    // Checkbox/Radio: 9px padding, constant across BOTH sizes — the glyph's
    // own fontSize is what differs, not this padding (FUT-2585, FUT-2767's
    // own Problem statement).
    const checkboxMd = computed(checkboxRootIn(canvas.getByTestId('checkbox-md')));
    expectPxClose(checkboxMd.paddingTop, 9);
    expectPxClose(checkboxMd.paddingLeft, 9);
    const checkboxSm = computed(checkboxRootIn(canvas.getByTestId('checkbox-sm')));
    expectPxClose(checkboxSm.paddingTop, 9);
    expectPxClose(checkboxSm.paddingLeft, 9);

    const radioMd = computed(radioRootIn(canvas.getByTestId('radio-md')));
    expectPxClose(radioMd.paddingTop, 9);
    expectPxClose(radioMd.paddingLeft, 9);
    const radioSm = computed(radioRootIn(canvas.getByTestId('radio-sm')));
    expectPxClose(radioSm.paddingTop, 9);
    expectPxClose(radioSm.paddingLeft, 9);

    // Switch (medium): track 58×38, switchBase padding 9px, thumb 20×20.
    const switchMdWrap = canvas.getByTestId('switch-md');
    const switchMdRoot = switchRootIn(switchMdWrap);
    expectPxClose(computed(switchMdRoot).width, 58);
    expectPxClose(computed(switchMdRoot).height, 38);
    const switchBaseMd = computed(switchBaseOf(switchMdWrap));
    expectPxClose(switchBaseMd.paddingTop, 9);
    expectPxClose(switchBaseMd.paddingLeft, 9);
    const thumbMd = computed(thumbOf(switchMdWrap));
    expectPxClose(thumbMd.width, 20);
    expectPxClose(thumbMd.height, 20);

    // Switch (small): track 40×24, switchBase padding 4px (the nested,
    // higher-specificity rule — NOT the flat 9px), thumb 16×16.
    const switchSmWrap = canvas.getByTestId('switch-sm');
    const switchSmRoot = switchRootIn(switchSmWrap);
    expectPxClose(computed(switchSmRoot).width, 40);
    expectPxClose(computed(switchSmRoot).height, 24);
    const switchBaseSm = computed(switchBaseOf(switchSmWrap));
    expectPxClose(switchBaseSm.paddingTop, 4);
    expectPxClose(switchBaseSm.paddingLeft, 4);
    const thumbSm = computed(thumbOf(switchSmWrap));
    expectPxClose(thumbSm.width, 16);
    expectPxClose(thumbSm.height, 16);

    // CHECKED (blocking issue 1): the thumb's gap from the track's own right
    // edge equals switchBase's OWN padding at that size (9px medium, 4px
    // small) — the design mirrors the unchecked LEFT inset, proven above.
    const switchMdChecked = canvas.getByTestId('switch-md-checked');
    expectGapClose(
      checkedGapFromRight(switchRootIn(switchMdChecked), thumbOf(switchMdChecked)),
      9,
    );
    const switchSmChecked = canvas.getByTestId('switch-sm-checked');
    expectGapClose(
      checkedGapFromRight(switchRootIn(switchSmChecked), thumbOf(switchSmChecked)),
      4,
    );

    // `@12-apps/ui`'s OWN Checkbox/RadioGroup (blocking issue 2): the SAME
    // 9px padding as raw MuiCheckbox/MuiRadio above — the theme override
    // reaches them because neither wrapper draws its own padding.
    const uiCheckbox = computed(canvas.getByTestId('ui-checkbox'));
    expectPxClose(uiCheckbox.paddingTop, 9);
    expectPxClose(uiCheckbox.paddingLeft, 9);
    const uiRadio = computed(canvas.getByTestId('ui-radio-group-radio-0'));
    expectPxClose(uiRadio.paddingTop, 9);
    expectPxClose(uiRadio.paddingLeft, 9);

    // `@12-apps/ui`'s OWN Switch (blocking issue 2): its OWN design numbers
    // (`SWITCH_SIZES.md`/`.sm`, `Switch.metrics.ts`), NOT MUI's 58×38/40×24 —
    // this file's `switchDensityOverrides()` never reaches it (see the
    // module doc comment), so at `density: 'normal'` these render exactly
    // the literal design px, unclobbered.
    const uiSwitchMdRoot = uiSwitchRootFor(canvas, 'ui-switch-md');
    expectPxClose(computed(uiSwitchMdRoot).width, 50);
    expectPxClose(computed(uiSwitchMdRoot).height, 26);
    expectPxClose(computed(switchBaseOf(uiSwitchMdRoot)).paddingTop, 1);
    expectPxClose(computed(thumbOf(uiSwitchMdRoot)).width, 22);

    const uiSwitchSmRoot = uiSwitchRootFor(canvas, 'ui-switch-sm');
    expectPxClose(computed(uiSwitchSmRoot).width, 42);
    expectPxClose(computed(uiSwitchSmRoot).height, 22);
    expectPxClose(computed(switchBaseOf(uiSwitchSmRoot)).paddingTop, 1);
    expectPxClose(computed(thumbOf(uiSwitchSmRoot)).width, 18);

    // `@12-apps/ui`'s OWN checked thumb: the SAME gap-equals-padding design,
    // computed from `Switch.metrics.ts`'s OWN table (`width - thumbSize -
    // padding * 2`, `Switch.styles.ts`'s `switchBaseSx`), not MUI's numbers.
    const uiSwitchMdCheckedRoot = uiSwitchRootFor(canvas, 'ui-switch-md-checked');
    expectGapClose(
      checkedGapFromRight(uiSwitchMdCheckedRoot, thumbOf(uiSwitchMdCheckedRoot)),
      1,
    );
    const uiSwitchSmCheckedRoot = uiSwitchRootFor(canvas, 'ui-switch-sm-checked');
    expectGapClose(
      checkedGapFromRight(uiSwitchSmCheckedRoot, thumbOf(uiSwitchSmCheckedRoot)),
      1,
    );
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

    // Checkbox/Radio: 9px × 0.9, both sizes.
    const checkboxMd = computed(checkboxRootIn(canvas.getByTestId('checkbox-md')));
    expectPxClose(checkboxMd.paddingTop, 8.1); // 9 * 0.9
    expectPxClose(checkboxMd.paddingLeft, 8.1);
    const checkboxSm = computed(checkboxRootIn(canvas.getByTestId('checkbox-sm')));
    expectPxClose(checkboxSm.paddingTop, 8.1);
    expectPxClose(checkboxSm.paddingLeft, 8.1);

    const radioMd = computed(radioRootIn(canvas.getByTestId('radio-md')));
    expectPxClose(radioMd.paddingTop, 8.1);
    expectPxClose(radioMd.paddingLeft, 8.1);
    const radioSm = computed(radioRootIn(canvas.getByTestId('radio-sm')));
    expectPxClose(radioSm.paddingTop, 8.1);
    expectPxClose(radioSm.paddingLeft, 8.1);

    // Switch (medium): every number × 0.9.
    const switchMdWrap = canvas.getByTestId('switch-md');
    const switchMdRoot = switchRootIn(switchMdWrap);
    expectPxClose(computed(switchMdRoot).width, 52.2); // 58 * 0.9
    expectPxClose(computed(switchMdRoot).height, 34.2); // 38 * 0.9
    const switchBaseMd = computed(switchBaseOf(switchMdWrap));
    expectPxClose(switchBaseMd.paddingTop, 8.1); // 9 * 0.9
    expectPxClose(switchBaseMd.paddingLeft, 8.1);
    const thumbMd = computed(thumbOf(switchMdWrap));
    expectPxClose(thumbMd.width, 18); // 20 * 0.9
    expectPxClose(thumbMd.height, 18);

    // Switch (small): every number × 0.9, including the nested switchBase/
    // thumb rule (the specificity trap Lesson 1 warns about).
    const switchSmWrap = canvas.getByTestId('switch-sm');
    const switchSmRoot = switchRootIn(switchSmWrap);
    expectPxClose(computed(switchSmRoot).width, 36); // 40 * 0.9
    expectPxClose(computed(switchSmRoot).height, 21.6); // 24 * 0.9
    const switchBaseSm = computed(switchBaseOf(switchSmWrap));
    expectPxClose(switchBaseSm.paddingTop, 3.6); // 4 * 0.9
    expectPxClose(switchBaseSm.paddingLeft, 3.6);
    const thumbSm = computed(thumbOf(switchSmWrap));
    expectPxClose(thumbSm.width, 14.4); // 16 * 0.9
    expectPxClose(thumbSm.height, 14.4);

    // CHECKED (blocking issue 1) — the regression this fix exists for: the
    // gap must scale to 8.1/3.6 (9/4 × 0.9), NOT stay pinned at the unscaled
    // 9/4 (or worse) an un-scaled `translateX(20px)`/`translateX(16px)` would
    // give once the track around it has already shrunk — the overshoot this
    // PR fixes. `checked-transform.md` in the doc comment above proves the
    // arithmetic; this is the pixel-level proof in a real layout engine.
    const switchMdChecked = canvas.getByTestId('switch-md-checked');
    expectGapClose(
      checkedGapFromRight(switchRootIn(switchMdChecked), thumbOf(switchMdChecked)),
      8.1, // 9 * 0.9
    );
    const switchSmChecked = canvas.getByTestId('switch-sm-checked');
    expectGapClose(
      checkedGapFromRight(switchRootIn(switchSmChecked), thumbOf(switchSmChecked)),
      3.6, // 4 * 0.9
    );

    // `@12-apps/ui`'s OWN Checkbox/RadioGroup: 9px × 0.9, same as raw above.
    const uiCheckbox = computed(canvas.getByTestId('ui-checkbox'));
    expectPxClose(uiCheckbox.paddingTop, 8.1);
    expectPxClose(uiCheckbox.paddingLeft, 8.1);
    const uiRadio = computed(canvas.getByTestId('ui-radio-group-radio-0'));
    expectPxClose(uiRadio.paddingTop, 8.1);
    expectPxClose(uiRadio.paddingLeft, 8.1);

    // `@12-apps/ui`'s OWN Switch: its OWN design numbers × 0.9 — proving the
    // wrapper scales with density ENTIRELY ON ITS OWN, with no help from
    // `switchDensityOverrides()` (which never reaches it — see the module
    // doc comment on `density-overrides.ts`), because every one of its
    // dimensions was ALREADY written through `rem(theme, px)` before this
    // ticket existed.
    const uiSwitchMdRoot = uiSwitchRootFor(canvas, 'ui-switch-md');
    expectPxClose(computed(uiSwitchMdRoot).width, 45); // 50 * 0.9
    expectPxClose(computed(uiSwitchMdRoot).height, 23.4); // 26 * 0.9
    expectPxClose(computed(switchBaseOf(uiSwitchMdRoot)).paddingTop, 0.9); // 1 * 0.9
    expectPxClose(computed(thumbOf(uiSwitchMdRoot)).width, 19.8); // 22 * 0.9

    const uiSwitchSmRoot = uiSwitchRootFor(canvas, 'ui-switch-sm');
    expectPxClose(computed(uiSwitchSmRoot).width, 37.8); // 42 * 0.9
    expectPxClose(computed(uiSwitchSmRoot).height, 19.8); // 22 * 0.9
    expectPxClose(computed(switchBaseOf(uiSwitchSmRoot)).paddingTop, 0.9); // 1 * 0.9
    expectPxClose(computed(thumbOf(uiSwitchSmRoot)).width, 16.2); // 18 * 0.9

    // `@12-apps/ui`'s OWN checked thumb, scaled ×0.9 — including the travel
    // DISTANCE itself (`width - thumbSize - padding * 2`, computed fresh from
    // the ALREADY-scaled geometry, so it moves consistently with everything
    // around it — no separate fix needed, unlike the raw MUI case above).
    const uiSwitchMdCheckedRoot = uiSwitchRootFor(canvas, 'ui-switch-md-checked');
    expectGapClose(
      checkedGapFromRight(uiSwitchMdCheckedRoot, thumbOf(uiSwitchMdCheckedRoot)),
      0.9, // 1 * 0.9
    );
    const uiSwitchSmCheckedRoot = uiSwitchRootFor(canvas, 'ui-switch-sm-checked');
    expectGapClose(
      checkedGapFromRight(uiSwitchSmCheckedRoot, thumbOf(uiSwitchSmCheckedRoot)),
      0.9, // 1 * 0.9
    );
  },
};
