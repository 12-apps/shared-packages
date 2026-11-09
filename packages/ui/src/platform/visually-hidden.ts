import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { sxRem } from '../tokens/relative';

/**
 * Out of sight, still read aloud: the box a screen-reader-only text sits in.
 * One shared copy, so a component that needs it does not reach into another
 * component's private styles.
 */
export const VISUALLY_HIDDEN_SX: SxProps<Theme> = {
  position: 'absolute',
  width: sxRem(1),
  height: sxRem(1),
  padding: 0,
  margin: sxRem(-1),
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
