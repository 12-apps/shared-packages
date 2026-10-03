/**
 * The approved boards' floating surface, for the "+N" list and the bell's
 * choices alike: the raised paper, a 1px edge, a 12px corner and a long, soft
 * shadow in the theme's ink — and the popover's own edge margin, 8px, so a
 * list can line up with a dock that rests 12px from a phone's edge.
 */
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { surfaces } from '@12-apps/ui/tokens';

export const FLOATING_PAPER = {
  sx: {
    bgcolor: (theme: Theme) => surfaces(theme).raised,
    border: 1,
    borderColor: 'divider',
    borderRadius: '12px',
    boxShadow: (theme: Theme) => `0 10px 28px ${alpha(theme.palette.text.primary, 0.22)}`,
  },
} as const;

export const FLOATING_MARGIN_PX = 8;
