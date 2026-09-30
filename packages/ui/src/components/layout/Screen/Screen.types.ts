import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type * as React from 'react';

import type { ScreenBaseProps } from './Screen.base';

export type { ScreenBaseProps, ScreenEdge } from './Screen.base';
export type ScreenProps = ScreenBaseProps & Omit<React.HTMLAttributes<HTMLDivElement>, keyof ScreenBaseProps> & {
  sx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
};
