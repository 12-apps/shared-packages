import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type React from 'react';

export type ParagraphVariant = 'default' | 'lead' | 'muted' | 'small';

export interface ParagraphProps extends React.HTMLAttributes<globalThis.HTMLParagraphElement> {
  variant?: ParagraphVariant;
  color?: Exclude<ColorValue, 'info'>;
  size?: SizeValue;
  children: React.ReactNode;
}