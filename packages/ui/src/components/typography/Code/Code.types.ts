import type { SizeValue } from '../../../tokens/scales';
import type React from 'react';

export type CodeVariant = 'inline' | 'block' | 'highlight';

export interface CodeProps extends React.HTMLAttributes<HTMLElement> {
  variant?: CodeVariant;
  language?: string;
  copyable?: boolean;
  /** The copy button's tooltip and name; defaults to `UI_LABELS['en-US'].code.copy`. */
  copyLabel?: string;
  /** The same button right after a copy; defaults to `UI_LABELS['en-US'].code.copied`. */
  copiedLabel?: string;
  lineNumbers?: boolean;
  size?: SizeValue;
  children: React.ReactNode;
}