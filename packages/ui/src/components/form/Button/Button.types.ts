import type { ButtonProps as MuiButtonProps } from '@mui/material/Button/index.js';
import type * as React from 'react';

import type { ButtonBaseProps } from './Button.base';

export type { ButtonBaseProps, ButtonVariant } from './Button.base';

export interface ButtonProps
  extends ButtonBaseProps,
    Omit<MuiButtonProps, 'variant' | 'color' | 'size' | keyof ButtonBaseProps> {
  /**
   * Click handler
   */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;

  /**
   * Focus handler
   */
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;

  /**
   * Blur handler
   */
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
}
