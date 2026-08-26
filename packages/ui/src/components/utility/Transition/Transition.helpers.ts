import type { Theme } from '@mui/material/styles';

import type { CustomTransitionProps, TransitionVariant } from './Transition.types';

type Duration = NonNullable<CustomTransitionProps['duration']>;
type Easing = NonNullable<CustomTransitionProps['easing']>;

/** An explicit `duration` wins in either form; otherwise the variant picks one. */
export const transitionDuration = (
  theme: Theme,
  variant: TransitionVariant,
  duration?: Duration,
): Duration => {
  if (typeof duration === 'number' || typeof duration === 'object') return duration;

  switch (variant) {
    case 'slide':
      return theme.transitions.duration.enteringScreen;
    case 'fade':
    case 'scale':
    case 'grow':
    case 'zoom':
      return theme.transitions.duration.shorter;
    default:
      return theme.transitions.duration.standard;
  }
};

/** As above: an explicit `easing` wins, otherwise the variant picks one. */
export const transitionEasing = (
  theme: Theme,
  variant: TransitionVariant,
  easing?: Easing,
): Easing => {
  if (typeof easing === 'string' || typeof easing === 'object') return easing;

  return variant === 'slide'
    ? theme.transitions.easing.easeOut
    : theme.transitions.easing.easeInOut;
};
