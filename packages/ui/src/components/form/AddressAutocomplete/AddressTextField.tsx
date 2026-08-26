import type { TextFieldProps } from '@mui/material/TextField';
import TextField from '@mui/material/TextField';
import { alpha, styled } from '@mui/material/styles';
import type { FC } from 'react';
import React from 'react';

import type { AddressAutocompleteProps } from './AddressAutocomplete.types';

// Kept module-local on purpose: the inferred type of a styled() component cannot
// be named across a module boundary here (TS2742), so the plain component below
// is what the rest of the folder imports.
const GlassTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.8)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
    transition: theme.transitions.create(['border-color', 'box-shadow', 'background']),
    '&:hover': {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.7)} 100%)`,
      borderColor: theme.palette.primary.main,
    },
    '&.Mui-focused': {
      background: theme.palette.background.paper,
      boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}`,
    },
    '& fieldset': {
      border: 'none',
    },
  },
}));

export type AddressTextFieldProps = Omit<TextFieldProps, 'variant'> & {
  addressVariant: AddressAutocompleteProps['variant'];
};

// 'glass' is not a MUI variant: it renders the outlined field with the frosted
// treatment on top.
export const AddressTextField: FC<AddressTextFieldProps> = ({ addressVariant, ...props }) =>
  addressVariant === 'glass' ? (
    <GlassTextField variant="outlined" {...props} />
  ) : (
    <TextField variant={addressVariant} {...props} />
  );
