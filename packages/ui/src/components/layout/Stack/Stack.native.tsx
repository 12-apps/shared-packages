import * as React from 'react';
import type { View } from 'react-native';

import type { StackProps } from './Stack.types.native';
import { withDividers } from './with-dividers';
import { Box } from '../Box/Box.native';

export const Stack = React.forwardRef<View, StackProps>(
  ({ direction = 'column', gap = 0, divider, children, ...rest }, ref) => (
    <Box ref={ref} direction={direction} gap={gap} {...rest}>
      {withDividers(children, divider)}
    </Box>
  ),
);

Stack.displayName = 'Stack';
