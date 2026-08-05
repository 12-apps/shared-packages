import { Divider } from '@mui/material';
import React from 'react';

import type { MenubarSeparatorProps } from './Menubar.types';

/**
 * The rule between two entries. Its own orientation is the bar's turned ninety
 * degrees: a horizontal bar is divided by vertical rules.
 */
export const MenubarSeparator: React.FC<MenubarSeparatorProps> = ({
  orientation = 'horizontal',
  className,
  style,
}) => (
  <Divider
    orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
    flexItem
    className={className}
    sx={{
      mx: orientation === 'horizontal' ? 1 : 0,
      my: orientation === 'vertical' ? 1 : 0,
      ...style,
    }}
  />
);
