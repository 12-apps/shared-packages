import type { ChipBaseProps } from './Chip.base';

export type { ChipBaseProps, ChipColor, ChipSize, ChipVariant } from './Chip.base';

/** The web `Chip`: the shared contract, plus the DOM's own styling hook. */
export interface ChipProps extends ChipBaseProps {
  /** Additional CSS classes */
  className?: string;
}
