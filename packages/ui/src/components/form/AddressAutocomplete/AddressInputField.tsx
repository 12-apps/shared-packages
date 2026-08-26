import CurrentLocationIcon from '@mui/icons-material/MyLocation';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import type { FC, ReactNode } from 'react';
import React from 'react';

import type { AddressAutocompleteProps } from './AddressAutocomplete.types';
import { AddressTextField } from './AddressTextField';

const CurrentLocationButton: FC<{
  disabled: boolean;
  onClick: () => void;
  currentLocationLabel: string;
}> = ({ disabled, onClick, currentLocationLabel }) => (
  <InputAdornment position="end">
    <IconButton
      edge="end"
      onClick={onClick}
      size="small"
      title={currentLocationLabel}
      disabled={disabled}
      data-testid="address-current-location-button"
    >
      <CurrentLocationIcon />
    </IconButton>
  </InputAdornment>
);

export interface AddressInputFieldProps {
  copy: AddressAutocompleteProps['copy'];
  params: AutocompleteRenderInputParams;
  addressVariant: AddressAutocompleteProps['variant'];
  label?: string;
  placeholder?: string;
  icon?: ReactNode;
  error: boolean;
  helperText?: string;
  required: boolean;
  disabled: boolean;
  loading: boolean;
  showCurrentLocation: boolean;
  onGetCurrentLocation: () => void;
}

export const AddressInputField: FC<AddressInputFieldProps> = ({
  copy,
  params,
  addressVariant,
  label,
  placeholder,
  icon,
  error,
  helperText,
  required,
  disabled,
  loading,
  showCurrentLocation,
  onGetCurrentLocation,
}) => (
  <AddressTextField
    {...params}
    addressVariant={addressVariant}
    label={label}
    placeholder={placeholder}
    error={error}
    helperText={helperText}
    required={required}
    InputProps={{
      ...params.InputProps,
      startAdornment: icon && <InputAdornment position="start">{icon}</InputAdornment>,
      endAdornment: (
        <>
          {loading && <CircularProgress color="inherit" size={20} data-testid="address-loading" />}
          {showCurrentLocation && (
            <CurrentLocationButton
              disabled={disabled}
              onClick={onGetCurrentLocation}
              currentLocationLabel={copy.useCurrentLocation}
            />
          )}
          {params.InputProps.endAdornment}
        </>
      ),
    }}
    inputProps={{ ...params.inputProps, 'data-testid': 'address-input' }}
  />
);
