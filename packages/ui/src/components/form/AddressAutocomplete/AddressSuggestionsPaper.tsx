import type { PaperProps } from '@mui/material/Paper/index.js';
import Box from '@mui/material/Box/index.js';
import Paper from '@mui/material/Paper/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React, { Children } from 'react';

import { rem } from '../../../tokens/relative';

export interface AddressSuggestionsPaperProps extends PaperProps {
  /**
   * Said when the list is open with nothing in it. MUI never renders its own
   * `noOptionsText` for a `freeSolo` field, so an empty list was a blank strip
   * (FUT-4162): the paper says it instead, exactly when MUI gave it no content
   * (no suggestions and no loading row).
   */
  emptyText?: React.ReactNode;
}

// The dropdown surface, frosted to match the glass field.
export const AddressSuggestionsPaper: FC<AddressSuggestionsPaperProps> = ({
  emptyText,
  children,
  ...props
}) => {
  const theme = useTheme();
  const empty = Children.toArray(children).length === 0;

  return (
    <Paper
      {...props}
      elevation={8}
      data-testid="address-suggestions-dropdown"
      sx={{
        mt: 1,
        background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
        backdropFilter: `blur(${rem(theme, 20)})`,
        WebkitBackdropFilter: `blur(${rem(theme, 20)})`,
        border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
      }}
    >
      {children}
      {empty && emptyText && (
        <Box
          role="presentation"
          data-testid="address-suggestions-empty"
          // Keeps the input focused, as MUI's own no-options row does.
          onMouseDown={(event) => event.preventDefault()}
          sx={{ px: 2, py: 1.5, color: 'text.secondary' }}
        >
          {emptyText}
        </Box>
      )}
    </Paper>
  );
};
