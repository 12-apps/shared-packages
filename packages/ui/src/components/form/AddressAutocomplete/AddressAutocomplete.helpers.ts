import type { AddressAutocompleteProps, AddressOptionValue } from './AddressAutocomplete.types';

// Below this the field clears its options rather than querying Places.
export const MIN_QUERY_LENGTH = 2;

type DefaultedKeys =
  | 'variant'
  | 'label'
  | 'placeholder'
  | 'floating'
  | 'error'
  | 'disabled'
  | 'required'
  | 'fullWidth'
  | 'defaultValue'
  | 'getCurrentLocation';

export type ResolvedAddressProps = AddressAutocompleteProps &
  Required<Pick<AddressAutocompleteProps, DefaultedKeys>>;

const ADDRESS_AUTOCOMPLETE_DEFAULTS: Pick<AddressAutocompleteProps, DefaultedKeys> = {
  variant: 'outlined',
  label: 'Address',
  placeholder: 'Enter an address',
  floating: false,
  error: false,
  disabled: false,
  required: false,
  fullWidth: true,
  defaultValue: '',
  getCurrentLocation: false,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: AddressAutocompleteProps): Partial<AddressAutocompleteProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<AddressAutocompleteProps>;

// Applied as a merge rather than destructuring defaults, which would otherwise
// put ten branches into the component's own complexity budget.
export const resolveAddressProps = (props: AddressAutocompleteProps): ResolvedAddressProps =>
  ({ ...ADDRESS_AUTOCOMPLETE_DEFAULTS, ...definedProps(props) }) as ResolvedAddressProps;

export const addressOptionLabel = (option: AddressOptionValue): string => {
  if (typeof option === 'string') return option;
  return option.description || '';
};

// A string only ever equals the same string, so a mixed pair is never a match.
export const isSameAddressOption = (
  option: AddressOptionValue,
  value: AddressOptionValue,
): boolean => {
  if (typeof option === 'string' || typeof value === 'string') return option === value;
  return option.place_id === value.place_id;
};
