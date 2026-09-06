import type { AvatarProps as MuiAvatarProps } from '@mui/material/Avatar/index.js';
import type React from 'react';

import type { AvatarBaseProps } from './Avatar.base';

export type {
  AvatarBaseProps,
  AvatarSize,
  AvatarStatus,
  AvatarVariant,
  ContentType,
} from './Avatar.base';

/** The web `Avatar`: the shared contract, plus MUI's own avatar props. */
export interface AvatarProps
  extends AvatarBaseProps,
    Omit<MuiAvatarProps, 'variant' | 'color' | 'children' | 'src' | 'alt'> {
  /**
   * Error handler for image loading
   */
  onError?: React.ReactEventHandler;

  /**
   * Click handler
   */
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}
