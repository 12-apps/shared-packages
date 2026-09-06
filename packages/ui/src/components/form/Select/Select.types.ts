import type { SelectProps as MuiSelectProps } from '@mui/material/Select/index.js';

import type { SelectBaseProps } from './Select.base';

export type { SelectBaseProps, SelectOption, SelectValue, SelectVariant } from './Select.base';

/**
 * The web `Select`: the shared contract, plus everything MUI's `Select`
 * accepts that the contract does not already name — `value`, `onChange`,
 * `MenuProps`, `renderValue`.
 *
 * `variant` and `size` are omitted from MUI's half alongside the rest of the
 * contract: MUI declares both in its own words (`small | medium`), and this
 * component speaks the house scale.
 */
export interface SelectProps
  extends SelectBaseProps,
    Omit<MuiSelectProps, 'variant' | 'size' | keyof SelectBaseProps> {
  /**
   * Test ID for testing purposes
   */
  'data-testid'?: string;
}
