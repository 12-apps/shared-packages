import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import React from 'react';

import type {
  CommandEmptyProps,
  CommandLoadingProps,
  CommandSeparatorProps,
} from './Command.types';

export const CommandEmpty: React.FC<CommandEmptyProps> = ({
  message = 'No results found',
  className,
  style,
  dataTestId,
}) => (
    <Box
      className={className}
      data-testid={dataTestId}
      sx={{
        p: 4,
        textAlign: 'center',
        color: 'text.secondary',
        ...style,
      }}
    >
      <Typography variant="body2">{message}</Typography>
    </Box>
  );

export const CommandLoading: React.FC<CommandLoadingProps> = ({
  message = 'Loading...',
  className,
  style,
  dataTestId,
}) => (
    <Box
      className={className}
      data-testid={dataTestId}
      sx={{
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        ...style,
      }}
    >
      <CircularProgress size={24} />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );

export const CommandSeparator: React.FC<CommandSeparatorProps> = ({
  className,
  style,
}) => <Divider className={className} sx={{ my: 1, ...style }} />;