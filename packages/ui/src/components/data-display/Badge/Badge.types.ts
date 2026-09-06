import type { BadgeProps as MuiBadgeProps } from '@mui/material/Badge/index.js';

import type { BadgeBaseProps } from './Badge.base';

export type {
  BadgeBaseProps,
  BadgePosition,
  BadgeSize,
  BadgeVariant,
} from './Badge.base';

/** The web `Badge`: the shared contract, plus MUI's own badge props. */
export interface BadgeProps
  extends BadgeBaseProps,
    Omit<
      MuiBadgeProps,
      | 'variant'
      | 'color'
      | 'content'
      | 'badgeContent'
      | 'children'
      | 'invisible'
      // MUI types these as `Booleanish`/its own unions through `AriaAttributes`;
      // the shared contract narrows them, and the narrower one is the contract.
      | 'aria-atomic'
      | 'aria-live'
      | 'aria-label'
    > {
  /**
   * Additional CSS class name
   */
  className?: string;
}
