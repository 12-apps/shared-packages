import { keyframes, type Theme } from '@mui/material/styles/index.js';

import { rem, rems } from '../../../tokens/relative';

/** Spring physics used by the draggable variant's snap-point animation. */
export const SPRING_CONFIG = {
  tension: 200,
  friction: 25,
  velocity: 0,
};

/** Velocity threshold for snap detection (pixels per millisecond). */
export const DEFAULT_VELOCITY_THRESHOLD = 0.5;

/** Drag resistance factor applied past the first and last snap points. */
export const DEFAULT_DRAG_RESISTANCE = 0.3;

export const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(var(--pulse-color), 0.4);
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 20)} rgba(var(--pulse-color), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--pulse-color), 0);
  }
`;

export const shimmerAnimation = (theme: Theme) => keyframes`
  0% {
    background-position: ${rem(theme, -1000)} 0;
  }
  100% {
    background-position: ${rem(theme, 1000)} 0;
  }
`;

export const glowAnimation = (theme: Theme) => keyframes`
  0%, 100% {
    box-shadow: ${rems(theme, 0, 0, 20, 5)} rgba(var(--glow-color), 0.3);
  }
  50% {
    box-shadow: ${rems(theme, 0, 0, 35, 10)} rgba(var(--glow-color), 0.5);
  }
`;
