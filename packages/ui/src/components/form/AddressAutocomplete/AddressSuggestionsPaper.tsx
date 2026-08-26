import type { PaperProps } from '@mui/material/Paper';
import Paper from '@mui/material/Paper';
import { alpha, useTheme } from '@mui/material/styles';
import type { FC } from 'react';
import React from 'react';

// The dropdown surface, frosted to match the glass field.
export const AddressSuggestionsPaper: FC<PaperProps> = (props) => {
  const theme = useTheme();

  return (
    <Paper
      {...props}
      elevation={8}
      data-testid="address-suggestions-dropdown"
      sx={{
        mt: 1,
        background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
      }}
    />
  );
};
