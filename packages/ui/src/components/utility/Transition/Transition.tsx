import Collapse from '@mui/material/Collapse/index.js';
import Fade from '@mui/material/Fade/index.js';
import Grow from '@mui/material/Grow/index.js';
import Slide from '@mui/material/Slide/index.js';
import Zoom from '@mui/material/Zoom/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { transitionDuration, transitionEasing } from './Transition.helpers';
import type { CustomTransitionProps } from './Transition.types';

export const Transition: React.FC<CustomTransitionProps> = ({
  children,
  variant = 'fade',
  direction = 'up',
  duration,
  delay = 0,
  easing,
  in: inProp,
  ...props
}) => {
  const theme = useTheme();

  const transitionProps = {
    in: inProp,
    timeout: transitionDuration(theme, variant, duration),
    easing: transitionEasing(theme, variant, easing),
    unmountOnExit: true,
    style: {
      transitionDelay: `${delay}ms`,
    },
    ...props,
  };

  // Every variant wraps the same three-deep structure; only the MUI transition
  // component differs.
  const content = (
    <div data-testid="transition-element">
      <div data-testid="transition-content">{children}</div>
    </div>
  );

  switch (variant) {
    case 'fade':
      return (
        <Fade {...transitionProps} data-testid="transition-wrapper">
          {content}
        </Fade>
      );

    case 'slide':
      return (
        <Slide direction={direction} {...transitionProps} data-testid="transition-wrapper">
          {content}
        </Slide>
      );

    case 'scale':
    case 'grow':
      return (
        <Grow {...transitionProps} data-testid="transition-wrapper">
          {content}
        </Grow>
      );

    case 'collapse':
      return (
        <Collapse {...transitionProps} data-testid="transition-wrapper">
          {content}
        </Collapse>
      );

    case 'zoom':
      return (
        <Zoom {...transitionProps} data-testid="transition-wrapper">
          {content}
        </Zoom>
      );

    default:
      return (
        <Fade {...transitionProps} data-testid="transition-wrapper">
          {content}
        </Fade>
      );
  }
};