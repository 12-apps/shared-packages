import { keyframes } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';

import { rem } from '../../../tokens/relative';

export const rotateAnimation = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

export const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

export const translateAnimation = (theme: Theme) => keyframes`
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(${rem(theme, -8)});
  }
  100% {
    transform: translateY(0px);
  }
`;

export const glowPulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 ${rem(theme, 5)} currentColor, 0 0 ${rem(theme, 10)} currentColor, 0 0 ${rem(theme, 15)} currentColor;
  }
  50% {
    box-shadow: 0 0 ${rem(theme, 10)} currentColor, 0 0 ${rem(theme, 20)} currentColor, 0 0 ${rem(theme, 30)} currentColor;
  }
  100% {
    box-shadow: 0 0 ${rem(theme, 5)} currentColor, 0 0 ${rem(theme, 10)} currentColor, 0 0 ${rem(theme, 15)} currentColor;
  }
`;

// New animation keyframes
export const bounceAnimation = (theme: Theme) => keyframes`
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(${rem(theme, -20)});
  }
  60% {
    transform: translateY(${rem(theme, -10)});
  }
`;

export const shakeAnimation = (theme: Theme) => keyframes`
  0%, 100% {
    transform: translateX(0);
  }
  10%, 30%, 50%, 70%, 90% {
    transform: translateX(${rem(theme, -4)});
  }
  20%, 40%, 60%, 80% {
    transform: translateX(${rem(theme, 4)});
  }
`;

export const flipAnimation = (theme: Theme) => keyframes`
  0% {
    transform: perspective(${rem(theme, 400)}) rotateY(0);
  }
  100% {
    transform: perspective(${rem(theme, 400)}) rotateY(360deg);
  }
`;

export const spinAnimation = keyframes`
  0% {
    transform: rotate(0deg) scale(1);
  }
  50% {
    transform: rotate(180deg) scale(1.2);
  }
  100% {
    transform: rotate(360deg) scale(1);
  }
`;

export const fadeInOutAnimation = keyframes`
  0%, 100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
`;

export const heartbeatAnimation = keyframes`
  0%, 100% {
    transform: scale(1);
  }
  5% {
    transform: scale(1.25);
  }
  10% {
    transform: scale(1);
  }
  15% {
    transform: scale(1.25);
  }
  20% {
    transform: scale(1);
  }
`;

export const wobbleAnimation = (theme: Theme) => keyframes`
  0%, 100% {
    transform: translateX(0) rotate(0deg);
  }
  15% {
    transform: translateX(${rem(theme, -10)}) rotate(-5deg);
  }
  30% {
    transform: translateX(${rem(theme, 8)}) rotate(3deg);
  }
  45% {
    transform: translateX(${rem(theme, -6)}) rotate(-3deg);
  }
  60% {
    transform: translateX(${rem(theme, 4)}) rotate(2deg);
  }
  75% {
    transform: translateX(${rem(theme, -2)}) rotate(-1deg);
  }
`;

export const morphAnimation = keyframes`
  0%, 100% {
    border-radius: 50%;
    transform: scale(1);
  }
  25% {
    border-radius: 30%;
    transform: scale(1.1);
  }
  50% {
    border-radius: 20%;
    transform: scale(0.95);
  }
  75% {
    border-radius: 40%;
    transform: scale(1.05);
  }
`;

export const swingAnimation = keyframes`
  20% {
    transform: rotate(15deg);
  }
  40% {
    transform: rotate(-10deg);
  }
  60% {
    transform: rotate(5deg);
  }
  80% {
    transform: rotate(-5deg);
  }
  100% {
    transform: rotate(0deg);
  }
`;

export const floatAnimation = (theme: Theme) => keyframes`
  0%, 100% {
    transform: translateY(0) translateX(0);
  }
  33% {
    transform: translateY(${rem(theme, -10)}) translateX(${rem(theme, -5)});
  }
  66% {
    transform: translateY(${rem(theme, 5)}) translateX(${rem(theme, 5)});
  }
`;

export const jelloAnimation = keyframes`
  0%, 100% {
    transform: scale(1, 1);
  }
  25% {
    transform: scale(0.9, 1.1);
  }
  50% {
    transform: scale(1.1, 0.9);
  }
  75% {
    transform: scale(0.95, 1.05);
  }
`;

export const rippleAnimation = keyframes`
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
`;

export const neonFlickerAnimation = (theme: Theme) => keyframes`
  0%, 100% {
    opacity: 1;
    filter: brightness(1) drop-shadow(0 0 ${rem(theme, 10)} currentColor);
  }
  10% {
    opacity: 0.8;
    filter: brightness(0.8) drop-shadow(0 0 ${rem(theme, 5)} currentColor);
  }
  20% {
    opacity: 1;
    filter: brightness(1.2) drop-shadow(0 0 ${rem(theme, 15)} currentColor);
  }
  30% {
    opacity: 0.9;
    filter: brightness(0.9) drop-shadow(0 0 ${rem(theme, 8)} currentColor);
  }
  40% {
    opacity: 1;
    filter: brightness(1.1) drop-shadow(0 0 ${rem(theme, 12)} currentColor);
  }
  50% {
    opacity: 0.95;
    filter: brightness(1) drop-shadow(0 0 ${rem(theme, 10)} currentColor);
  }
  60% {
    opacity: 0.85;
    filter: brightness(0.85) drop-shadow(0 0 ${rem(theme, 6)} currentColor);
  }
  70% {
    opacity: 1;
    filter: brightness(1.15) drop-shadow(0 0 ${rem(theme, 14)} currentColor);
  }
  80% {
    opacity: 0.9;
    filter: brightness(0.95) drop-shadow(0 0 ${rem(theme, 9)} currentColor);
  }
  90% {
    opacity: 1;
    filter: brightness(1.05) drop-shadow(0 0 ${rem(theme, 11)} currentColor);
  }
`;

export const breatheAnimation = keyframes`
  0%, 100% {
    transform: scale(1);
    filter: brightness(1);
  }
  50% {
    transform: scale(1.05);
    filter: brightness(1.2);
  }
`;

// Size configurations
