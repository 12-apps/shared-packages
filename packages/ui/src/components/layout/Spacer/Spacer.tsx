import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { SPACER_FLEX_GROW, SPACER_FLEX_SHRINK, spacerDimensions } from './Spacer.metrics';
import type { SpacerProps } from './Spacer.types';
import { resolveTestId } from '../../../platform/test-id';

export const Spacer: React.FC<SpacerProps> = ({
  size,
  direction,
  width,
  height,
  flex = false,
  className,
  ...testIdProps
}) => {
  const theme = useTheme();

  // From the shared metrics, not a table of our own: the native `Spacer` reads
  // the same units, so the two renderers cannot disagree on a step.
  const dimensions = spacerDimensions({ size, direction, width, height }, (units) => theme.spacing(units));

  return (
    <Box
      className={className}
      data-testid={resolveTestId(testIdProps)}
      sx={{
        width: dimensions.width,
        height: dimensions.height,
        flex: flex ? SPACER_FLEX_GROW : undefined,
        flexShrink: SPACER_FLEX_SHRINK,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
      aria-hidden="true"
    />
  );
};
