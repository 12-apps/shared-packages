import { keyframes, type Theme } from '@mui/material/styles/index.js';

import { rem } from '../../../tokens/relative';

export const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 10)} currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

export const slideInUp = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateY(${rem(theme, 8)});
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const slideInDown = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateY(${rem(theme, -8)});
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const slideInLeft = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateX(${rem(theme, 8)});
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const slideInRight = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateX(${rem(theme, -8)});
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const scaleIn = keyframes`
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
`;

// Arrow component
