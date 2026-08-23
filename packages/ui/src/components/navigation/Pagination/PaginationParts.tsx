import { Box, FormControl, MenuItem, Select, Typography } from '@mui/material';
import { styled } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import { scaleFor } from './Pagination.helpers';

// Kept module-local: styled() components cannot be exported across a module
// boundary here without tripping TS2742.
const ItemsPerPageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
}));

const PageInfoContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
}));

export interface ItemsPerPageSelectProps {
  /** The label in front of the select. REQUIRED — it was `"Show:"`. */
  pageSizeLabel: string;
  value: number;
  options: number[];
  size: string;
  disabled: boolean;
  testId: string;
  onChange: (value: number) => void;
}

export const ItemsPerPageSelect: FC<ItemsPerPageSelectProps> = ({
  pageSizeLabel,
  value,
  options,
  size,
  disabled,
  testId,
  onChange,
}) => (
  <ItemsPerPageContainer>
    <Typography variant="body2" color="text.secondary">
      {pageSizeLabel}
    </Typography>
    <FormControl size="small" sx={{ minWidth: 80 }}>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value as number)}
        disabled={disabled}
        data-testid={testId}
        sx={{
          '& .MuiSelect-select': {
            fontSize: scaleFor(size, ['0.875rem', '1rem', '1.125rem']),
            py: scaleFor(size, [0.5, 1, 1.5]),
          },
        }}
      >
        {options.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  </ItemsPerPageContainer>
);

export const PageInfo: FC<{ size: string; testId: string; children: React.ReactNode }> = ({
  size,
  testId,
  children,
}) => (
  <PageInfoContainer>
    <Typography
      variant="body2"
      color="text.secondary"
      fontSize={scaleFor(size, ['0.75rem', '0.875rem', '1rem'])}
      data-testid={testId}
    >
      {children}
    </Typography>
  </PageInfoContainer>
);
