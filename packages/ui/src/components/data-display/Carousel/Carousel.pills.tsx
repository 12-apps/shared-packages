import IconButton from '@mui/material/IconButton/index.js';
import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { focusRing, indicatorAttrs, pillColours } from './Carousel.look';
import { rem } from '../../../tokens/scales';

interface PillProps {
  index: number;
  label: string;
  isActive: boolean;
  onPhoto?: boolean;
  onSelect: () => void;
}

/**
 * A pill: 8 design px tall (the current one 20 wide), inside a 24 px square
 * target, so the pitch of a row of them is the target and there is no gap.
 */
export const PillIndicator: React.FC<PillProps> = ({ index, label, isActive, onPhoto = false, onSelect }) => {
  const theme = useTheme();

  return (
    <IconButton
      size="small"
      {...indicatorAttrs(index, isActive, label)}
      onClick={onSelect}
      sx={{
        p: 0,
        width: rem(theme, 24),
        minWidth: rem(theme, 24),
        height: rem(theme, 24),
        '&:focus-visible': focusRing(theme),
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'block',
          width: rem(theme, isActive ? 20 : 8),
          height: rem(theme, 8),
          borderRadius: rem(theme, 4),
          backgroundColor: pillColours(theme, isActive, onPhoto),
          transition: theme.transitions.create(['width', 'background-color']),
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      />
    </IconButton>
  );
};
