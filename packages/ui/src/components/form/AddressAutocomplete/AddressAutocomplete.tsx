import LocationIcon from '@mui/icons-material/LocationOn';
import type { FC } from 'react';
import React from 'react';

import { resolveAddressProps } from './AddressAutocomplete.helpers';
import { useAddressAutocomplete } from './AddressAutocomplete.hooks';
import type { AddressAutocompleteProps } from './AddressAutocomplete.types';
import { AddressAutocompleteField } from './AddressAutocompleteField';
import { AddressFallbackField } from './AddressFallbackField';

export const AddressAutocomplete: FC<AddressAutocompleteProps> = (componentProps) => {
  const resolved = resolveAddressProps(componentProps);
  const { defaultValue, googleMapsApiKey, restrictions, onSelect, icon = <LocationIcon /> } =
    resolved;
  const fieldProps = { ...resolved, icon };

  const state = useAddressAutocomplete({
    defaultValue,
    googleMapsApiKey,
    restrictions,
    onSelect,
  });

  // Until the API answers there is nothing to autocomplete against, so the field
  // stands in disabled — spinning, or explaining why it never loaded.
  if (!state.isLoaded || state.mapsError) {
    return <AddressFallbackField {...fieldProps} mapsError={state.mapsError} />;
  }

  return <AddressAutocompleteField {...fieldProps} {...state} />;
};

export default AddressAutocomplete;
