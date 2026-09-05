import type { BoxProps as MuiBoxProps } from '@mui/material/Box/index.js';

import { BOX_BASE_KEYS, type BoxBaseProps } from './Box.base';

export type {
  BoxAlign,
  BoxBackground,
  BoxBaseProps,
  BoxDimension,
  BoxDirection,
  BoxJustify,
  BoxRadius,
  BoxSpacingProps,
} from './Box.base';
export { BOX_BASE_KEYS } from './Box.base';

/**
 * The web `Box`: the neutral props, plus whatever MUI's `Box` accepts that they
 * do not already name. `sx` stays available — it is the web's escape hatch and
 * the reason nothing a web screen does today has to change.
 */
export type BoxProps = BoxBaseProps & Omit<MuiBoxProps, (typeof BOX_BASE_KEYS)[number] | 'children'>;
