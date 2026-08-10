import type { SizeValue } from '../../../tokens/scales';
export type SpacerSize = SizeValue;
export type SpacerDirection = 'horizontal' | 'vertical' | 'both';

export interface SpacerProps {
  size?: SpacerSize;
  direction?: SpacerDirection;
  width?: number | string;
  height?: number | string;
  flex?: boolean;
  className?: string;
  'data-testid'?: string;
}
