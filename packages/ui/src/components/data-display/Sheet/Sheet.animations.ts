import { keyframes } from '@mui/material/styles';

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

export const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(var(--pulse-color), 0.4);
  }
  70% {
    box-shadow: 0 0 0 20px rgba(var(--pulse-color), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--pulse-color), 0);
  }
`;

export const shimmerAnimation = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

export const glowAnimation = keyframes`
  0%, 100% {
    box-shadow: 0 0 20px 5px rgba(var(--glow-color), 0.3);
  }
  50% {
    box-shadow: 0 0 35px 10px rgba(var(--glow-color), 0.5);
  }
`;
