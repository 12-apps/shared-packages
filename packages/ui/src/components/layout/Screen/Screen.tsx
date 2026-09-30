import MuiBox from '@mui/material/Box/index.js';
import * as React from 'react';

import { SCREEN_EDGES } from './Screen.base';
import type { ScreenProps } from './Screen.types';
import { Box } from '../Box/Box';
import { splitBoxProps } from '../Box/box-layout';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';

function sxEntries(sx: ScreenProps['sx']) {
  if (sx === undefined) return [];
  return Array.isArray(sx) ? sx : [sx];
}

/** A bounded page viewport; browser keyboards remain the browser's responsibility. */
export const Screen = React.forwardRef<HTMLDivElement, ScreenProps>(({
  children, scroll = true, safeAreaEdges = SCREEN_EDGES,
  keyboardAvoiding: _keyboardAvoiding = true, keyboardVerticalOffset: _keyboardVerticalOffset = 0,
  bg = 'default', sx, contentSx, ...props
}, ref) => {
  const { layout, rest } = splitBoxProps(props);
  const testID = resolveTestId(layout);
  const safeArea = Object.fromEntries(SCREEN_EDGES.map((edge) => [
    `padding${edge[0]!.toUpperCase()}${edge.slice(1)}`,
    safeAreaEdges.includes(edge) ? `env(safe-area-inset-${edge}, 0px)` : 0,
  ]));
  return (
    <Box ref={ref} bg={bg} dataTestId={testID} {...rest}
      sx={[{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', ...safeArea },
        ...sxEntries(sx)]}>
      <MuiBox data-testid={testID ? `${testID}-viewport` : undefined}
        sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: scroll ? 'auto' : 'hidden' }}>
        <Box {...withoutTestIdProps(layout)} direction="column"
          sx={[scroll ? { flexGrow: 1, flexShrink: 0 } : { flex: 1, minHeight: 0, minWidth: 0 }, ...sxEntries(contentSx)]}>
          {children}
        </Box>
      </MuiBox>
    </Box>
  );
});
Screen.displayName = 'Screen';
