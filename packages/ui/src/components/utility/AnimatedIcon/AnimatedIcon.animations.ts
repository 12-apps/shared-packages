import { keyframes } from '@mui/material/styles/index.js';

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

export const translateAnimation = keyframes`
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-8px);
  }
  100% {
    transform: translateY(0px);
  }
`;

export const glowPulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 5px currentColor, 0 0 10px currentColor, 0 0 15px currentColor;
  }
  50% {
    box-shadow: 0 0 10px currentColor, 0 0 20px currentColor, 0 0 30px currentColor;
  }
  100% {
    box-shadow: 0 0 5px currentColor, 0 0 10px currentColor, 0 0 15px currentColor;
  }
`;

// New animation keyframes
export const bounceAnimation = keyframes`
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-20px);
  }
  60% {
    transform: translateY(-10px);
  }
`;

export const shakeAnimation = keyframes`
  0%, 100% {
    transform: translateX(0);
  }
  10%, 30%, 50%, 70%, 90% {
    transform: translateX(-4px);
  }
  20%, 40%, 60%, 80% {
    transform: translateX(4px);
  }
`;

export const flipAnimation = keyframes`
  0% {
    transform: perspective(400px) rotateY(0);
  }
  100% {
    transform: perspective(400px) rotateY(360deg);
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

export const wobbleAnimation = keyframes`
  0%, 100% {
    transform: translateX(0) rotate(0deg);
  }
  15% {
    transform: translateX(-10px) rotate(-5deg);
  }
  30% {
    transform: translateX(8px) rotate(3deg);
  }
  45% {
    transform: translateX(-6px) rotate(-3deg);
  }
  60% {
    transform: translateX(4px) rotate(2deg);
  }
  75% {
    transform: translateX(-2px) rotate(-1deg);
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

export const floatAnimation = keyframes`
  0%, 100% {
    transform: translateY(0) translateX(0);
  }
  33% {
    transform: translateY(-10px) translateX(-5px);
  }
  66% {
    transform: translateY(5px) translateX(5px);
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

export const neonFlickerAnimation = keyframes`
  0%, 100% {
    opacity: 1;
    filter: brightness(1) drop-shadow(0 0 10px currentColor);
  }
  10% {
    opacity: 0.8;
    filter: brightness(0.8) drop-shadow(0 0 5px currentColor);
  }
  20% {
    opacity: 1;
    filter: brightness(1.2) drop-shadow(0 0 15px currentColor);
  }
  30% {
    opacity: 0.9;
    filter: brightness(0.9) drop-shadow(0 0 8px currentColor);
  }
  40% {
    opacity: 1;
    filter: brightness(1.1) drop-shadow(0 0 12px currentColor);
  }
  50% {
    opacity: 0.95;
    filter: brightness(1) drop-shadow(0 0 10px currentColor);
  }
  60% {
    opacity: 0.85;
    filter: brightness(0.85) drop-shadow(0 0 6px currentColor);
  }
  70% {
    opacity: 1;
    filter: brightness(1.15) drop-shadow(0 0 14px currentColor);
  }
  80% {
    opacity: 0.9;
    filter: brightness(0.95) drop-shadow(0 0 9px currentColor);
  }
  90% {
    opacity: 1;
    filter: brightness(1.05) drop-shadow(0 0 11px currentColor);
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
