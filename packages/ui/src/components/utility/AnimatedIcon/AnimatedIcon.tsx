import Box from '@mui/material/Box/index.js';
import { styled } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { iconSx, sizeConfigs } from './AnimatedIcon.styles';
import type { IconStyleFlags } from './AnimatedIcon.styles';
import type { AnimatedIconProps } from './AnimatedIcon.types';

const AnimationContainer = styled(Box)<IconStyleFlags>(({ theme, ...flags }) => ({
  ...iconSx(theme, flags),
}));

const DEFAULTS = {
  variant: 'none',
  size: 'md',
  duration: 2,
  delay: 0,
  loop: true,
  glow: false,
  glass: false,
  metallic: false,
  gradient: false,
  shadow: 'none',
  ripple: false,
  neon: false,
  holographic: false,
} satisfies Partial<AnimatedIconProps>;

type ResolvedProps = AnimatedIconProps & Required<Pick<AnimatedIconProps, keyof typeof DEFAULTS>>;

export const AnimatedIcon: FC<AnimatedIconProps> = (props) => {
  const {
    children, variant, size, color, duration, delay, loop, glow, glass, glowColor,
    metallic, gradient, shadow, ripple, neon, holographic, className, style,
    'aria-label': ariaLabel, onClick, tabIndex, onFocus, onBlur, dataTestId,
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const config = sizeConfigs[size] ?? sizeConfigs.md;

  return (
    <AnimationContainer
      $size={config.size}
      $fontSize={config.fontSize}
      $animationVariant={variant}
      $duration={duration}
      $delay={delay}
      $loop={loop}
      $glow={glow}
      $glass={glass}
      $glowColor={glowColor}
      $customColor={color}
      $metallic={metallic}
      $gradient={gradient}
      $shadow={shadow}
      $ripple={ripple}
      $neon={neon}
      $holographic={holographic}
      className={className}
      style={style}
      role="img"
      aria-label={ariaLabel || `Animated ${variant} icon`}
      onClick={onClick}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onBlur={onBlur}
      data-testid={dataTestId}
    >
      {children}
    </AnimationContainer>
  );
};

export default AnimatedIcon;
