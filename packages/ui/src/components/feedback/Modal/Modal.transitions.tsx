import Fade from '@mui/material/Fade';
import Slide from '@mui/material/Slide';
import React from 'react';

export interface TransitionProps {
  children?: React.ReactElement;
  in?: boolean;
  timeout?: number;
}

/**
 * A slide from one edge, as its own component type.
 *
 * These are built once at module scope rather than per render: a component
 * created inside a render is a new type on every pass, so React unmounts the
 * modal's whole subtree and remounts it — which also restarts the transition it
 * was in the middle of.
 */
const slideFrom = (direction: 'up' | 'down', displayName: string) => {
  const Transition = React.forwardRef<HTMLElement, TransitionProps>(({ children, ...rest }, ref) =>
    children ? (
      <Slide direction={direction} ref={ref} {...rest}>
        {children}
      </Slide>
    ) : null,
  );
  Transition.displayName = displayName;
  return Transition;
};

const SlideDown = slideFrom('down', 'SlideDown');
const SlideUp = slideFrom('up', 'SlideUp');

/** A top modal drops in, a bottom one rises; the rest fade. */
export const TRANSITIONS: Record<string, React.ElementType> = {
  top: SlideDown,
  bottom: SlideUp,
};

export const transitionFor = (variant: string): React.ElementType =>
  TRANSITIONS[variant] ?? Fade;
