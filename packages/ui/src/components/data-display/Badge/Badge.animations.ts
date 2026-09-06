import { keyframes } from '@mui/material/styles/index.js';

import { BOUNCE, FADE_IN_SCALE, GLOW_PULSE, PULSE } from './Badge.metrics';

export const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(${PULSE.scale});
    opacity: ${PULSE.opacity};
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

// Define bounce animation
export const bounceAnimation = keyframes`
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0) scale(1);
  }
  40% {
    transform: translateY(-${BOUNCE.lift}px) scale(${BOUNCE.scale});
  }
  60% {
    transform: translateY(-${BOUNCE.secondLift}px) scale(${BOUNCE.secondScale});
  }
`;

// Define shimmer animation
export const shimmerAnimation = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

// Define fade in animation with scale
export const fadeInScaleAnimation = keyframes`
  0% {
    opacity: 0;
    transform: scale(${FADE_IN_SCALE.from});
  }
  50% {
    transform: scale(${FADE_IN_SCALE.overshoot});
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
`;

// Define glow pulse animation
export const glowPulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 ${GLOW_PULSE.fromBlur}px ${GLOW_PULSE.fromSpread}px rgba(var(--glow-color), ${GLOW_PULSE.fromAlpha});
  }
  50% {
    box-shadow: 0 0 ${GLOW_PULSE.toBlur}px ${GLOW_PULSE.toSpread}px rgba(var(--glow-color), ${GLOW_PULSE.toAlpha});
  }
  100% {
    box-shadow: 0 0 ${GLOW_PULSE.fromBlur}px ${GLOW_PULSE.fromSpread}px rgba(var(--glow-color), ${GLOW_PULSE.fromAlpha});
  }
`;
