import type { ChipProps } from '@mui/material/Chip';
import Chip from '@mui/material/Chip';
import React from 'react';

// A plain component rather than styled(Chip): a styled component's inferred type
// cannot be named across a module boundary in this package (TS2742), and both
// the results list and the palette footer need this one.
export const ShortcutChip: React.FC<ChipProps> = (props) => (
  <Chip
    {...props}
    sx={{
      height: 20,
      fontSize: '0.7rem',
      fontFamily: 'monospace',
      ...props.sx,
    }}
  />
);
