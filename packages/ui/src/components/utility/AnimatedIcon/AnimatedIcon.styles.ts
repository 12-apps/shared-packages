import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import {
  bounceAnimation,
  breatheAnimation,
  fadeInOutAnimation,
  flipAnimation,
  floatAnimation,
  glowPulseAnimation,
  heartbeatAnimation,
  jelloAnimation,
  morphAnimation,
  neonFlickerAnimation,
  pulseAnimation,
  rippleAnimation,
  rotateAnimation,
  shakeAnimation,
  spinAnimation,
  swingAnimation,
  translateAnimation,
  wobbleAnimation,
} from './AnimatedIcon.animations';
import type { AnimationSize, AnimationVariant } from './AnimatedIcon.types';

export const sizeConfigs: Record<AnimationSize, { size: number; fontSize: number }> = {
  sm: { size: 24, fontSize: 20 },
  md: { size: 32, fontSize: 28 },
  lg: { size: 48, fontSize: 44 },
  xl: { size: 64, fontSize: 60 },
};

/**
 * Every variant produces the same shorthand — keyframes, duration, easing,
 * iteration count, delay — so only the three things that actually differ are
 * tabulated. `scale` multiplies the caller's duration for the variants that
 * read as slower than the rest.
 */
const ANIMATIONS: Record<string, { keyframes: string; easing: string; scale: number }> = {
  rotate: { keyframes: `${rotateAnimation}`, easing: 'linear', scale: 1 },
  pulse: { keyframes: `${pulseAnimation}`, easing: 'ease-in-out', scale: 1 },
  translate: { keyframes: `${translateAnimation}`, easing: 'ease-in-out', scale: 1 },
  bounce: { keyframes: `${bounceAnimation}`, easing: 'ease-in-out', scale: 1 },
  shake: { keyframes: `${shakeAnimation}`, easing: 'ease-in-out', scale: 1 },
  flip: { keyframes: `${flipAnimation}`, easing: 'ease-in-out', scale: 1 },
  spin: { keyframes: `${spinAnimation}`, easing: 'ease-in-out', scale: 1 },
  fadeInOut: { keyframes: `${fadeInOutAnimation}`, easing: 'ease-in-out', scale: 1 },
  heartbeat: { keyframes: `${heartbeatAnimation}`, easing: 'ease-in-out', scale: 1 },
  wobble: { keyframes: `${wobbleAnimation}`, easing: 'ease-in-out', scale: 1 },
  morph: { keyframes: `${morphAnimation}`, easing: 'ease-in-out', scale: 1 },
  swing: { keyframes: `${swingAnimation}`, easing: 'ease-in-out', scale: 1 },
  jello: { keyframes: `${jelloAnimation}`, easing: 'ease-in-out', scale: 1 },
  float: { keyframes: `${floatAnimation}`, easing: 'ease-in-out', scale: 2 },
  neonFlicker: { keyframes: `${neonFlickerAnimation}`, easing: 'ease-in-out', scale: 2 },
  breathe: { keyframes: `${breatheAnimation}`, easing: 'ease-in-out', scale: 1.5 },
};

const animationFor = (
  variant: AnimationVariant,
  duration: number,
  delay: number,
  loop: boolean,
) => {
  const spec = ANIMATIONS[variant];
  if (!spec) return 'none';

  const iterationCount = loop ? 'infinite' : '1';
  return `${spec.keyframes} ${duration * spec.scale}s ${spec.easing} ${iterationCount} ${delay > 0 ? `${delay}s` : '0s'}`;
};

const SHADOWS: Record<string, (theme: Theme) => string> = {
  soft: (theme) => `0 4px 20px ${alpha(theme.palette.common.black, 0.15)}`,
  hard: (theme) => `4px 4px 0px ${alpha(theme.palette.common.black, 0.25)}`,
  elevated: (theme) =>
    `0 10px 40px ${alpha(theme.palette.common.black, 0.2)}, 0 2px 10px ${alpha(theme.palette.common.black, 0.1)}`,
};

export interface IconStyleFlags {
  $size: number;
  $fontSize: number;
  $animationVariant: AnimationVariant;
  $duration: number;
  $delay: number;
  $loop: boolean;
  $glow: boolean;
  $glass: boolean;
  $glowColor?: string;
  $customColor?: string;
  $metallic?: boolean;
  $gradient?: boolean;
  $shadow?: 'soft' | 'hard' | 'elevated' | 'none';
  $ripple?: boolean;
  $neon?: boolean;
  $holographic?: boolean;
}

/**
 * The four surface treatments that paint the icon themselves — metallic,
 * gradient, neon and holographic — each run a second animation alongside the
 * chosen one, so they all need the base animation string.
 */
const effectStyles = (
  theme: Theme,
  flags: IconStyleFlags,
  animation: string,
  color: string,
): CSSObject => {
  const { $glass, $metallic, $gradient, $neon, $holographic } = flags;

  return {
    ...($glass && {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.2)}, ${alpha(theme.palette.background.paper, 0.1)})`,
      backdropFilter: 'blur(10px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
      boxShadow: `inset 0 1px 1px ${alpha(theme.palette.common.white, 0.3)}, 0 8px 32px ${alpha(theme.palette.common.black, 0.1)}`,
    }),
    ...($metallic && {
      background: `linear-gradient(145deg,
      ${theme.palette.grey[300]} 0%,
      ${theme.palette.grey[500]} 25%,
      ${theme.palette.grey[400]} 50%,
      ${theme.palette.grey[600]} 75%,
      ${theme.palette.grey[400]} 100%)`,
      backgroundSize: '200% 200%',
      animation: `${animation}, ${breatheAnimation} 4s ease-in-out infinite`,
      boxShadow: `inset 0 2px 4px ${alpha(theme.palette.common.white, 0.5)},
                inset 0 -2px 4px ${alpha(theme.palette.common.black, 0.3)},
                0 4px 8px ${alpha(theme.palette.common.black, 0.2)}`,
    }),
    ...($gradient && {
      background: `linear-gradient(135deg,
      ${theme.palette.primary.main} 0%,
      ${theme.palette.secondary.main} 100%)`,
      backgroundSize: '200% 200%',
      animation: `${animation}, ${breatheAnimation} 3s ease-in-out infinite`,
    }),
    ...($neon && {
      color,
      textShadow: `0 0 10px ${color}, 0 0 20px ${color}, 0 0 30px ${color}`,
      filter: `brightness(1.2) contrast(1.2)`,
      animation: `${animation}, ${neonFlickerAnimation} 3s ease-in-out infinite`,
    }),
    ...($holographic && {
      background: `linear-gradient(45deg,
      ${theme.palette.primary.main} 0%,
      ${theme.palette.secondary.main} 25%,
      ${theme.palette.error.main} 50%,
      ${theme.palette.warning.main} 75%,
      ${theme.palette.primary.main} 100%)`,
      backgroundSize: '400% 400%',
      animation: `${animation}, ${floatAnimation} 6s ease-in-out infinite`,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      filter: `hue-rotate(0deg)`,
      '@keyframes hueRotate': {
        '0%': { filter: 'hue-rotate(0deg)' },
        '100%': { filter: 'hue-rotate(360deg)' },
      },
      '&::before': {
        content: '""',
        position: 'absolute' as const,
        inset: -2,
        borderRadius: '50%',
        background: 'inherit',
        filter: 'blur(10px)',
        opacity: 0.5,
        zIndex: -1,
      },
    }),
  };
};

export const iconSx = (theme: Theme, flags: IconStyleFlags): CSSObject => {
  const {
    $size, $fontSize, $animationVariant, $duration, $delay, $loop,
    $glow, $glowColor, $customColor, $shadow, $ripple, $neon,
  } = flags;

  const color = $customColor || theme.palette.primary.main;
  const glowColor = $glowColor || color;
  const animation = animationFor($animationVariant, $duration, $delay, $loop);

  // Both selectors size the same glyph — MUI icons render an MuiSvgIcon-root,
  // a bare child renders an svg.
  const glyphSize = { fontSize: $fontSize, width: $fontSize, height: $fontSize };

  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: $size,
    height: $size,
    color,
    animation,
    position: 'relative' as const,
    cursor: 'default',
    borderRadius: '50%',
    transition: 'all 0.3s ease',
    boxShadow: SHADOWS[$shadow ?? 'none']?.(theme) ?? 'none',
    ...($glow && {
      '&::before': {
        content: '""',
        position: 'absolute' as const,
        inset: -8,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${alpha(glowColor, 0.3)} 0%, transparent 70%)`,
        animation: `${glowPulseAnimation} ${$duration * 1.2}s ease-in-out infinite`,
        zIndex: -1,
      },
      filter: `drop-shadow(0 0 8px ${alpha(glowColor, 0.5)})`,
    }),
    ...effectStyles(theme, flags, animation, color),
    ...($ripple && {
      '&::after': {
        content: '""',
        position: 'absolute' as const,
        inset: 0,
        borderRadius: '50%',
        border: `2px solid ${color}`,
        animation: `${rippleAnimation} ${$duration * 1.5}s ease-out infinite`,
      },
    }),
    '& .MuiSvgIcon-root': glyphSize,
    '& svg': glyphSize,
    '&:hover': {
      transform: 'scale(1.05)',
      filter: $neon ? `brightness(1.4) contrast(1.3)` : undefined,
    },
  };
};
