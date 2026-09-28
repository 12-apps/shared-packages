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
  /**
   * Draw the field as a search box that filters the options as you type,
   * with a list of bounded height.
   *
   * Left unset, it follows the option count: a list longer than
   * {@link SEARCHABLE_MIN_OPTIONS} - 1 options searches, a shorter one opens
   * as a plain menu. `multiple` and `renderValue` always keep the menu.
   */
  searchable?: boolean;
  /**
   * What the searchable list says when nothing matches the typed text. The
   * host's sentence: this library ships no copy. Unset, the empty list shows
   * no message.
   */
  noOptionsText?: string;
}
