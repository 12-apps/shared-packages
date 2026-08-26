import LocationIcon from '@mui/icons-material/LocationOn';
import Box from '@mui/material/Box/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import type { FC, HTMLAttributes } from 'react';
import React from 'react';

import type { AddressOptionValue } from './AddressAutocomplete.types';

// Module-local: styled() components cannot be exported across a module boundary
// here without tripping TS2742.
const SuggestionItem = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1.5),
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1.5),
  cursor: 'pointer',
  transition: theme.transitions.create(['background-color']),
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
}));

const LocationIconWrapper = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(0.5),
  color: theme.palette.text.secondary,
}));

const AddressText = styled(Box)(({ theme }) => ({
  flex: 1,
  '& .primary': {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: theme.palette.text.primary,
    marginBottom: theme.spacing(0.25),
  },
  '& .secondary': {
    fontSize: '0.8rem',
    color: theme.palette.text.secondary,
  },
}));

// Predictions carry the street line and the rest already split; freeSolo text has
// to be split on the first comma to get the same two lines.
const optionText = (option: AddressOptionValue) => {
  if (typeof option === 'string') {
    return {
      testId: 'address-suggestion-text',
      primary: option.split(',')[0],
      secondary: option.split(',').slice(1).join(','),
    };
  }

  return {
    testId: 'address-prediction-text',
    primary: option.structured_formatting?.main_text || option.description?.split(',')[0],
    secondary:
      option.structured_formatting?.secondary_text ||
      option.description?.split(',').slice(1).join(','),
  };
};

export interface AddressOptionProps {
  optionProps: HTMLAttributes<HTMLLIElement>;
  option: AddressOptionValue;
  index: number;
}

export const AddressOption: FC<AddressOptionProps> = ({ optionProps, option, index }) => {
  const { testId, primary, secondary } = optionText(option);

  return (
    <li {...optionProps} data-testid={`address-suggestion-${index}`}>
      <SuggestionItem>
        <LocationIconWrapper>
          <LocationIcon fontSize="small" />
        </LocationIconWrapper>
        <AddressText data-testid={testId}>
          <div className="primary">{primary}</div>
          <div className="secondary">{secondary}</div>
        </AddressText>
      </SuggestionItem>
    </li>
  );
};
