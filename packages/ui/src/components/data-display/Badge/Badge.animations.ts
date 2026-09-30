import { keyframes } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';

import { rem, rems } from '../../../tokens/relative';

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
export const bounceAnimation = (theme: Theme) => keyframes`
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0) scale(1);
  }
  40% {
    transform: translateY(${rem(theme, -BOUNCE.lift)}) scale(${BOUNCE.scale});
  }
  60% {
    transform: translateY(${rem(theme, -BOUNCE.secondLift)}) scale(${BOUNCE.secondScale});
  }
`;

// Define shimmer animation
export const shimmerAnimation = (theme: Theme) => keyframes`
  0% {
    background-position: ${rem(theme, -1000)} 0;
  }
  100% {
    background-position: ${rem(theme, 1000)} 0;
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
export const glowPulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 ${rems(theme, GLOW_PULSE.fromBlur, GLOW_PULSE.fromSpread)} rgba(var(--glow-color), ${GLOW_PULSE.fromAlpha});
  }
  50% {
    box-shadow: 0 0 ${rems(theme, GLOW_PULSE.toBlur, GLOW_PULSE.toSpread)} rgba(var(--glow-color), ${GLOW_PULSE.toAlpha});
  }
  100% {
    box-shadow: 0 0 ${rems(theme, GLOW_PULSE.fromBlur, GLOW_PULSE.fromSpread)} rgba(var(--glow-color), ${GLOW_PULSE.fromAlpha});
  }
`;
