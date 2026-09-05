import type React from 'react';

import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/** The contract both renderers honour; see `Button.base.ts` for why it is its own file. */
export type TextVariant = 'body' | 'heading' | 'caption' | 'code';
export type TextWeight = 'light' | 'normal' | 'medium' | 'semibold' | 'bold';

/**
 * The contract both renderers honour. Nothing here names a DOM or a React
 * Native type: the web adds `HTMLAttributes` and `as` below, the native side
 * adds `TextProps` from react-native in `Text.types.native.ts`.
 */
export interface TextBaseProps {
  variant?: TextVariant;
  color?: ColorValue;
  size?: SizeValue;
  weight?: TextWeight;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  children: React.ReactNode;
  testID?: string;
  dataTestId?: string;
}
