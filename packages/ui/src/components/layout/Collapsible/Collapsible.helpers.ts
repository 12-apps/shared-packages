import type { Theme } from '@mui/material/styles/index.js';

import type { CollapsibleVariant } from './Collapsible.types';

/**
 * `smooth` and `default` share their timing; only `spring` differs, stretching
 * the duration and overshooting past the target before settling.
 */
export const transitionSettings = (
  theme: Theme,
  variant: CollapsibleVariant,
  duration: number,
  easing?: string,
): { duration: number; easing: string } => {
  if (variant === 'spring') {
    return {
      duration: duration * 1.2,
      easing: easing || 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    };
  }

  return { duration, easing: easing || theme.transitions.easing.easeInOut };
};

interface RegionState {
  open: boolean;
  disabled: boolean;
  dataTestId?: string;
}

/**
 * Shared by both implementations: a disabled collapsible reads as collapsed to
 * assistive technology whatever its `open` prop says, because it cannot be
 * operated to see the rest.
 */
export const regionAttrs = ({ open, disabled, dataTestId }: RegionState) => ({
  'data-disabled': disabled,
  'data-testid': dataTestId,
  role: 'region',
  'aria-expanded': open && !disabled,
  'aria-hidden': disabled || !open,
});

export const dimmedStyles = (disabled: boolean) => ({
  opacity: disabled ? 0.6 : 1,
  pointerEvents: (disabled ? 'none' : 'auto') as 'none' | 'auto',
});

export const triggerStyles = (
  theme: Theme,
  { disabled, expanded }: { disabled: boolean; expanded: boolean },
) => {
  const restingBackground = expanded ? theme.palette.action.selected : 'transparent';

  return {
    width: '100%',
    padding: theme.spacing(1, 2),
    border: 'none',
    backgroundColor: restingBackground,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    transition: theme.transitions.create(['background-color', 'opacity'], {
      duration: theme.transitions.duration.short,
    }),
    opacity: disabled ? 0.6 : 1,
    '&:hover': {
      backgroundColor: disabled
        ? 'transparent'
        : expanded
          ? theme.palette.action.selected
          : theme.palette.action.hover,
    },
    '&:focus': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
    '&:active': {
      backgroundColor: disabled ? 'transparent' : theme.palette.action.focus,
    },
  };
};
