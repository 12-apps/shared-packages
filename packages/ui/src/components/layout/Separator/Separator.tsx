import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { separatorMargin, separatorStyles } from './Separator.styles';
import type { SeparatorProps } from './Separator.types';

export const Separator: React.FC<SeparatorProps> = ({
  variant = 'solid',
  orientation = 'horizontal',
  size = 'md',
  color,
  margin,
  length,
  children,
  className,
  'data-testid': dataTestId,
}) => {
  const theme = useTheme();
  const styles = separatorStyles(theme, { variant, orientation, size, color, margin, length });

  if (children) {
    const isHorizontal = orientation === 'horizontal';

    return (
      <Box
        className={className}
        // The plain branch below has always carried the caller's hook; this one
        // silently dropped it, so a LABELLED separator was the one variant no
        // test could address except through its own words.
        data-testid={dataTestId}
        sx={{
          display: 'flex',
          alignItems: 'center',
          margin: separatorMargin(size, margin),
          flexDirection: isHorizontal ? 'row' : 'column',
          gap: theme.spacing(2),
        }}
      >
        <Box sx={styles} />
        {/*
          No background behind the label. The two rules and the words are a FLEX
          ROW — the rules stop where the label starts — so there is nothing for a
          background to mask, and painting one made the label a coloured pill on
          every surface that is not `background.default`. On a white card it read
          as a highlight nobody had asked for.
        */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ flexShrink: 0, padding: theme.spacing(0, 1) }}
        >
          {children}
        </Typography>
        <Box sx={styles} />
      </Box>
    );
  }

  return (
    <Box
      className={className}
      sx={styles}
      role="separator"
      aria-orientation={orientation}
      data-testid={dataTestId}
    />
  );
};
