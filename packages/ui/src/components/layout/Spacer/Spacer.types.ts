import type { SpacerBaseProps } from './Spacer.base';

export type { SpacerBaseProps, SpacerDimension, SpacerDirection, SpacerSize } from './Spacer.base';

/** The web `Spacer`: the shared contract, plus the DOM's class hook and its own test-id spelling. */
export interface SpacerProps extends SpacerBaseProps {
  className?: string;
  'data-testid'?: string;
}
