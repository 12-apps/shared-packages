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

export const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.5);
    opacity: 0.5;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
`;

export const gradientShiftAnimation = keyframes`
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
`;
