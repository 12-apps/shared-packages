import type * as React from 'react';

import type { BoxBaseProps } from '../Box/Box.base';

/**
 * A `Box` that is always a flex container, with an optional divider between
 * children — MUI's `Stack`, on the neutral prop set. `direction` defaults to
 * `column` and `gap` to `0`, as MUI's does.
 */
export interface StackBaseProps extends Omit<BoxBaseProps, 'direction'> {
  direction?: 'row' | 'column';
  /** Rendered between every pair of children. */
  divider?: React.ReactNode;
}
