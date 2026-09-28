import { SEARCHABLE_MIN_OPTIONS } from './Select.metrics';
import type { SelectProps } from './Select.types';

/**
 * Whether `props` should render as a search box.
 *
 * Its own module, apart from `Select.searchable.tsx`, so deciding costs nothing:
 * the searchable engine (MUI `Autocomplete`) is only fetched when this says yes.
 */
export function shouldSearch(props: SelectProps): boolean {
  if (props.multiple || props.renderValue) return false;
  if (props.searchable !== undefined) return props.searchable;
  return props.options.length >= SEARCHABLE_MIN_OPTIONS;
}
