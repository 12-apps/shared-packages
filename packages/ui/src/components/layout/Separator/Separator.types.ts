import type { SizeValue } from '../../../tokens/scales';
import type { ReactNode } from 'react';

export type SeparatorVariant = 'solid' | 'dashed' | 'dotted' | 'gradient';
export type SeparatorOrientation = 'horizontal' | 'vertical';
export type SeparatorSize = SizeValue;

export interface SeparatorProps {
  variant?: SeparatorVariant;
  orientation?: SeparatorOrientation;
  size?: SeparatorSize;
  color?: string;
  margin?: number | string;
  length?: number | string;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}
