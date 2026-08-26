import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { alpha, styled } from '@mui/material/styles';
import type { FC } from 'react';
import React from 'react';

// Kept module-local: styled() components cannot be exported across a module
// boundary here without tripping TS2742.
const SearchBar = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(2),
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 2,
  width: '90%',
  maxWidth: 400,
}));

const SearchField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    background: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: theme.shape.borderRadius * 2,
    '& fieldset': {
      borderColor: alpha(theme.palette.divider, 0.2),
    },
  },
}));

export interface MapSearchBarProps {
  /** The field's accessible name — it renders no visible label. REQUIRED. */
  label: string;
  value: string;
  placeholder: string;
  isSearching: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const MapSearchBar: FC<MapSearchBarProps> = ({
  label,
  value,
  placeholder,
  isSearching,
  onChange,
  onSubmit,
}) => (
  <SearchBar>
    <SearchField
      fullWidth
      size="small"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyPress={onSubmit}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" sx={{ opacity: isSearching ? 0.5 : 1 }} />
          </InputAdornment>
        ),
      }}
      disabled={isSearching}
      aria-label={label}
    />
  </SearchBar>
);
