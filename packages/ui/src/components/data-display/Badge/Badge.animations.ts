import { keyframes } from '@mui/material/styles';

export const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(1.2);
    opacity: 0.7;
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
    transform: translateY(-8px) scale(1.05);
  }
  60% {
    transform: translateY(-4px) scale(1.02);
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
    transform: scale(0.5);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
`;

// Define glow pulse animation
export const glowPulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 5px 2px rgba(var(--glow-color), 0.4);
  }
  50% {
    box-shadow: 0 0 20px 4px rgba(var(--glow-color), 0.8);
  }
  100% {
    box-shadow: 0 0 5px 2px rgba(var(--glow-color), 0.4);
  }
`;
