import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH `Spacer` RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here, on purpose: this file ships in both
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against.
 */
export type SpacerSize = SizeValue;
export type SpacerDirection = 'horizontal' | 'vertical' | 'both';

/**
 * An explicit dimension: a px number, a percentage, `auto`, or any CSS length.
 * The web hands a string to the DOM as it is; the native renderer reads the CSS
 * lengths it can (`rem`, `em`, `px`) against a 16px root and ignores the rest.
 */
export type SpacerDimension = number | string;

export interface SpacerBaseProps {
  /** A step of the house scale, in spacing units — see `SPACER_SIZE_UNITS`. */
  size?: SpacerSize;
  /** Which axes the step applies to; the other keeps whatever `width`/`height` says. */
  direction?: SpacerDirection;
  /** Overrides the step on that axis, whatever `direction` is. */
  width?: SpacerDimension;
  height?: SpacerDimension;
  /** Grow to fill the free space in a flex row or column. */
  flex?: boolean;
  testID?: string;
  dataTestId?: string;
}
