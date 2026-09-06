import type { SelectVariant } from './Select.base';
import type { InputVariant } from '../Input/Input.base';
import { ICON_SIZES } from '../../../icons/Icon.types';
import type { UiTheme } from '../../../tokens/theme';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Select` RENDERERS DRAW WITH.
 *
 * A `Select` on the web IS an `OutlinedInput` with a display slot and an arrow
 * where the value would be typed, so the box's own numbers — the padding, the
 * border, the radius, the field edge — are `Input.metrics.ts`'s, read through
 * {@link inputVariantFor} rather than restated. What is here is what a select
 * has and a text field does not: the arrow, the option list, and the two
 * heights MUI's `FormControl` offers.
 */

/** Our three variants onto the `Input` variant that draws the same box. */
export const inputVariantFor = (variant: SelectVariant): InputVariant =>
  variant === 'default' ? 'outlined' : variant;

/**
 * The house scale as a `FormControl` size.
 *
 * Not `muiSize`: that collapses five onto MUI's three, and a FormControl takes
 * only two — `sm` draws small and EVERY other step, `xs` included, draws
 * medium. Restated from `Select.tsx`'s `formControlSize` so the native side
 * reads the same lossy map rather than inventing a kinder one.
 */
export const selectInputSize = (size: SizeValue | undefined): 'sm' | 'md' =>
  size === 'sm' ? 'sm' : 'md';

/**
 * The arrow: MUI's `ArrowDropDown` at `SvgIcon`'s medium size, 7px from the
 * right edge, turned over while the list is open. The display slot reserves
 * 32px for it, so the flow-laid glyph takes the difference as a margin.
 */
export const SELECT_ICON = {
  size: ICON_SIZES.md,
  right: 7,
  displayPaddingRight: 32,
  openRotateDeg: 180,
} as const;

/** What the glyph leaves between itself and the value: 32 - 24 - 7. */
export const SELECT_ICON_GAP =
  SELECT_ICON.displayPaddingRight - SELECT_ICON.size - SELECT_ICON.right;

/** `.MuiSelect-select`'s floor, MUI's `1.4375em` at the 16px body size. */
export const SELECT_DISPLAY_MIN_HEIGHT = 23;

/**
 * The option list: MUI's `Menu` over a `MenuList` of `MenuItem`s.
 *
 * `selectedAlpha` is `palette.action.selectedOpacity`, which MUI doubles in
 * dark mode; `disabledOpacity` is `palette.action.disabledOpacity`. Neither is
 * on `UiTheme`, whose `action` carries colours rather than opacities.
 */
export const SELECT_MENU = {
  itemMinHeight: 48,
  itemPaddingVertical: 6,
  itemPaddingHorizontal: 16,
  listPaddingVertical: 8,
  selectedAlpha: { light: 0.08, dark: 0.16 },
  disabledOpacity: 0.38,
  /** MUI's `Menu` paper is `calc(100% - 96px)` tall at most. */
  maxHeightInset: 96,
} as const;

/** MUI's `theme.shadows[8]`, the elevation a `Menu` paper rests at. */
export const MUI_MENU_SHADOW =
  '0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12)';

/** The wash behind the option the value currently names. */
export const selectedWashAlpha = (theme: UiTheme): number =>
  theme.mode === 'dark' ? SELECT_MENU.selectedAlpha.dark : SELECT_MENU.selectedAlpha.light;

/**
 * The box a select draws IS the input's box, so these are the input's tables
 * under this component's names — the border widths, the glass and gradient
 * alphas, the halo and the pulse. Restating them here is how the two controls
 * would come to disagree about what an outlined field looks like.
 */
export {
  INPUT_BORDER as SELECT_BORDER,
  INPUT_GLASS as SELECT_GLASS,
  INPUT_GLOW as SELECT_GLOW,
  INPUT_GRADIENT as SELECT_GRADIENT,
  INPUT_PULSE as SELECT_PULSE,
} from '../Input/Input.metrics';
