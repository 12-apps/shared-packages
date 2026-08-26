import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import type { FC, ReactNode } from 'react';
import React from 'react';

import type { AddressAutocompleteProps } from './AddressAutocomplete.types';
import { AddressTextField } from './AddressTextField';

export interface AddressFallbackFieldProps {
  copy: AddressAutocompleteProps['copy'];
  variant: AddressAutocompleteProps['variant'];
  label?: string;
  placeholder?: string;
  icon?: ReactNode;
  floating: boolean;
  fullWidth: boolean;
  mapsError: string | null;
}

// Stands in for the Autocomplete before Google Maps is usable: a disabled field
// that either spins or explains why it never loaded.
export const AddressFallbackField: FC<AddressFallbackFieldProps> = ({
  copy,
  variant,
  label,
  placeholder,
  icon,
  floating,
  fullWidth,
  mapsError,
}) => {
  const startAdornment = icon ? <InputAdornment position="start">{icon}</InputAdornment> : undefined;

  if (!mapsError) {
    return (
      <AddressTextField
        addressVariant={variant}
        label={floating ? undefined : label}
        placeholder={copy.loadingMaps}
        disabled
        fullWidth={fullWidth}
        InputProps={{
          startAdornment,
          endAdornment: <CircularProgress color="inherit" size={20} />,
        }}
      />
    );
  }

  return (
    <Box>
      <AddressTextField
        addressVariant={variant}
        label={floating ? undefined : label}
        placeholder={placeholder}
        error
        disabled
        fullWidth={fullWidth}
        helperText={mapsError}
        InputProps={{ startAdornment }}
      />
      <Alert severity="error" sx={{ mt: 1 }}>
        {copy.mapsLoadFailed}
      </Alert>
    </Box>
  );
};
