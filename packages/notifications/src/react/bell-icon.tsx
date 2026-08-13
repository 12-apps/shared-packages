/** Inline SVG bell (no icon-library dependency in this package). */
import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

export function BellIcon({
  size = 28,
  dim = false,
}: {
  size?: number;
  dim?: boolean;
}): JSX.Element {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      sx={{
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        opacity: dim ? 0.4 : 1,
      }}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Box>
  );
}
