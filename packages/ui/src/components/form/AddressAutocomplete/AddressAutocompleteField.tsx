import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import type { FC } from 'react';
import React from 'react';

import {
  addressOptionLabel,
  isSameAddressOption,
  MIN_QUERY_LENGTH,
  type ResolvedAddressProps,
} from './AddressAutocomplete.helpers';
import type { AddressAutocompleteState } from './AddressAutocomplete.hooks';
import { AddressInputField } from './AddressInputField';
import { AddressOption } from './AddressOption';
import { AddressSuggestionsPaper } from './AddressSuggestionsPaper';

export type AddressAutocompleteFieldProps = ResolvedAddressProps & AddressAutocompleteState;

// The live field, rendered once Google Maps (or the mock stand-in) is ready.
export const AddressAutocompleteField: FC<AddressAutocompleteFieldProps> = ({
  copy,
  variant,
  label,
  placeholder,
  icon,
  floating,
  error,
  helperText,
  disabled,
  required,
  fullWidth,
  getCurrentLocation,
  inputValue,
  options,
  loading,
  apiError,
  handleInputChange,
  handleSelect,
  handleGetCurrentLocation,
}) => (
  <Box data-testid="address-autocomplete-container">
    <Autocomplete
      freeSolo
      options={options}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      onChange={handleSelect}
      loading={loading}
      disabled={disabled}
      fullWidth={fullWidth}
      getOptionLabel={addressOptionLabel}
      isOptionEqualToValue={isSameAddressOption}
      PaperComponent={AddressSuggestionsPaper}
      noOptionsText={
        inputValue.length <= MIN_QUERY_LENGTH ? 'Type at least 3 characters' : 'No addresses found'
      }
      renderOption={({ key, ...optionProps }, option, state) => (
        <AddressOption
          key={key}
          optionProps={optionProps}
          option={option}
          index={state.index}
        />
      )}
      renderInput={(params) => (
        <AddressInputField
          copy={copy}
          params={params}
          addressVariant={variant}
          label={floating ? undefined : label}
          placeholder={placeholder}
          icon={icon}
          error={error || !!apiError}
          helperText={apiError || helperText}
          required={required}
          disabled={disabled}
          loading={loading}
          showCurrentLocation={getCurrentLocation && !loading}
          onGetCurrentLocation={handleGetCurrentLocation}
        />
      )}
    />
    {apiError && (
      <Alert severity="warning" sx={{ mt: 1 }}>
        {apiError}
      </Alert>
    )}
  </Box>
);
