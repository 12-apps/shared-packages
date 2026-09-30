import { keyframes } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';

import { rem } from '../../../tokens/relative';

export const glowAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 ${rem(theme, 5)} currentColor;
  }
  50% {
    box-shadow: 0 0 ${rem(theme, 15)} currentColor, 0 0 ${rem(theme, 25)} currentColor;
  }
  100% {
    box-shadow: 0 0 ${rem(theme, 5)} currentColor;
  }
`;

export const slideAnimation = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateX(${rem(theme, -20)});
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const scaleAnimation = keyframes`
  0% {
    transform: scale(0.95);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
`;

export const rippleAnimation = keyframes`
  0% {
    transform: scale(0);
    opacity: 1;
  }
  100% {
    transform: scale(4);
    opacity: 0;
  }
`;

