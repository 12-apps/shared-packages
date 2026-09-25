import type { TextFieldProps } from '@mui/material/TextField/index.js';
import TextField from '@mui/material/TextField/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React from 'react';

import type { AddressAutocompleteProps } from './AddressAutocomplete.types';

import { fieldEdge } from '../../../tokens/field-edge';
import { fieldRadius } from '../../../tokens/field-radius';
import { fieldControlStyles, fieldTextFieldStyles } from '../../../tokens/field-height';
import { rem } from '../../../tokens/relative';

// Kept module-local on purpose: the inferred type of a styled() component cannot
// be named across a module boundary here (TS2742), so the plain component below
// is what the rest of the folder imports.
const GlassTextField = styled(TextField)(({ theme }) => ({
  ...fieldControlStyles(theme),
  '& .MuiOutlinedInput-root': {
    borderRadius: fieldRadius(theme),
    background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.8)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`,
    backdropFilter: `blur(${rem(theme, 10)})`,
    WebkitBackdropFilter: `blur(${rem(theme, 10)})`,
    border: `1px solid ${fieldEdge(theme)}`,
    transition: theme.transitions.create(['border-color', 'box-shadow', 'background']),
    '&:hover': {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.7)} 100%)`,
      borderColor: theme.palette.primary.main,
    },
    '&.Mui-focused': {
      background: theme.palette.background.paper,
      boxShadow: `0 0 0 ${rem(theme, 2)} ${alpha(theme.palette.primary.main, 0.25)}`,
    },
    '& fieldset': {
      border: 'none',
    },
  },
}));

/** The plain variants: MUI's own field, on the theme's field radius. */
const FieldTextField = styled(TextField)(({ theme }) => fieldTextFieldStyles(theme));

export type AddressTextFieldProps = Omit<TextFieldProps, 'variant'> & {
  addressVariant: AddressAutocompleteProps['variant'];
};

// 'glass' is not a MUI variant: it renders the outlined field with the frosted
// treatment on top.
export const AddressTextField: FC<AddressTextFieldProps> = ({ addressVariant, ...props }) =>
  addressVariant === 'glass' ? (
    <GlassTextField variant="outlined" {...props} />
  ) : (
    <FieldTextField variant={addressVariant} {...props} />
  );
