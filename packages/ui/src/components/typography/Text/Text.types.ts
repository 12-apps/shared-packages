import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type React from 'react';

export type TextVariant = 'body' | 'heading' | 'caption' | 'code';

export interface TextProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: TextVariant;
  color?: Exclude<ColorValue, 'info'>;
  size?: SizeValue;
  weight?: 'light' | 'normal' | 'medium' | 'semibold' | 'bold';
  as?: keyof React.JSX.IntrinsicElements;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  children: React.ReactNode;
}