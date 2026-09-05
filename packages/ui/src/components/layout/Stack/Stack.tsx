import * as React from 'react';

import type { StackProps } from './Stack.types';
import { withDividers } from './with-dividers';
import { Box } from '../Box/Box';

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ direction = 'column', gap = 0, divider, children, ...rest }, ref) => (
    <Box ref={ref} direction={direction} gap={gap} {...rest}>
      {withDividers(children, divider)}
    </Box>
  ),
);

Stack.displayName = 'Stack';
