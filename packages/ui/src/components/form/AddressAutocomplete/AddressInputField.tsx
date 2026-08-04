import CurrentLocationIcon from '@mui/icons-material/MyLocation';
import type { AutocompleteRenderInputParams } from '@mui/material';
import { CircularProgress, IconButton, InputAdornment } from '@mui/material';
import type { FC, ReactNode } from 'react';
import React from 'react';

import type { AddressAutocompleteProps } from './AddressAutocomplete.types';
import { AddressTextField } from './AddressTextField';

const CurrentLocationButton: FC<{ disabled: boolean; onClick: () => void }> = ({
  disabled,
  onClick,
}) => (
  <InputAdornment position="end">
    <IconButton
      edge="end"
      onClick={onClick}
      size="small"
      title="Use current location"
      disabled={disabled}
      data-testid="address-current-location-button"
    >
      <CurrentLocationIcon />
    </IconButton>
  </InputAdornment>
);

export interface AddressInputFieldProps {
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
            <CurrentLocationButton disabled={disabled} onClick={onGetCurrentLocation} />
          )}
          {params.InputProps.endAdornment}
        </>
      ),
    }}
    inputProps={{ ...params.inputProps, 'data-testid': 'address-input' }}
  />
);
