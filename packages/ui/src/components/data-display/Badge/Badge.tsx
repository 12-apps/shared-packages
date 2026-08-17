import { Badge as MuiBadge, Zoom } from '@mui/material';
import { styled } from '@mui/material';
import React, { useEffect,useState } from 'react';

import {
  badgeStyles,
  getAnchorOrigin } from './Badge.styles';
import {
  badgeContentOf,
  definedAria,
  formatCount,
  resolveBadgeProps } from './Badge.helpers';
import type { ResolvedBadgeProps } from './Badge.helpers';
import { buildBadgeContent } from './BadgeContent';
import type { BadgeProps, BadgeSize, BadgeVariant } from './Badge.types';
export type { BadgeProps } from './Badge.types';

// Define pulse animation
const StyledBadge = styled(MuiBadge, {
  shouldForwardProp: (prop) =>
    ![
      'customVariant',
      'customSize',
      'customColor',
      'glow',
      'pulse',
      'animate',
      'shimmer',
      'bounce',
      'hasIcon',
    ].includes(prop as string) })<{
  customVariant?: BadgeVariant;
  customSize?: BadgeSize;
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
  animate?: boolean;
  shimmer?: boolean;
  bounce?: boolean;
  hasIcon?: boolean;
}>(({
  theme,
  customVariant,
  customSize = 'md',
  customColor = 'primary',
  glow,
  pulse,
  animate,
  shimmer,
  bounce,
  hasIcon }) => {
  return badgeStyles({
    theme,
    customVariant,
    customSize,
    customColor,
    glow,
    pulse,
    animate,
    shimmer,
    bounce,
    hasIcon });
});

const CLOSE_DELAY_MS = 300;
const ANIMATION_MS = 1000;

// A one-shot flag so bounce/animate run on mount and then stop.
const useMountAnimation = (enabled: boolean) => {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    setIsAnimating(true);
    const timer = window.setTimeout(() => setIsAnimating(false), ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  return isAnimating;
};

// The chip itself. Local because StyledBadge cannot cross a module boundary
// (TS2742).
const BadgeSurface: React.FC<
  ResolvedBadgeProps & {
    innerRef: React.Ref<HTMLSpanElement>;
    isVisible: boolean;
    isAnimating: boolean;
    shouldBeInvisible: boolean;
    finalBadgeContent: React.ReactNode;
    aria: Record<string, string | boolean>;
    rest: Record<string, unknown>;
  }
> = ({ innerRef, isVisible, isAnimating, shouldBeInvisible, finalBadgeContent, aria, rest, ...p }) => {
  const testId = p['data-testid'];

  return (
    <Zoom in={isVisible} timeout={CLOSE_DELAY_MS}>
      <StyledBadge
        ref={innerRef}
        className={p.className}
        customVariant={p.variant}
        customSize={p.size}
        customColor={p.color}
        glow={p.glow}
        pulse={p.pulse}
        animate={p.animate}
        shimmer={p.shimmer}
        bounce={p.bounce && isAnimating}
        hasIcon={Boolean(p.icon)}
        badgeContent={finalBadgeContent}
        variant={p.variant === 'dot' ? 'dot' : 'standard'}
        anchorOrigin={getAnchorOrigin(p.position)}
        invisible={shouldBeInvisible}
        data-testid={testId || 'badge'}
        slotProps={{
          badge: {
            ...aria,
            // @ts-expect-error - MUI Badge slotProps doesn't include data-testid in types, but it works at runtime
            'data-testid': testId ? `${testId}-content-wrapper` : 'badge-content-wrapper' } }}
        {...rest}
      >
        {p.children}
      </StyledBadge>
    </Zoom>
  );
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>((componentProps, ref) => {
  const resolved = resolveBadgeProps(componentProps);
  const {
    variant,
    size,
    color: _color,
    glow: _glow,
    pulse: _pulse,
    animate,
    shimmer: _shimmer,
    bounce,
    max,
    showZero,
    position: _position,
    children: _children,
    invisible,
    closable,
    onClose,
    icon,
    'aria-label': ariaLabel,
    'aria-live': ariaLive = 'polite',
    'aria-atomic': ariaAtomic = true,
    'data-testid': dataTestId,
    className: _className,
    content: _content,
    badgeContent: _badgeContent,
    ...props
  } = resolved;

  const [isVisible, setIsVisible] = useState(true);
  const isAnimating = useMountAnimation(animate || bounce);

  const handleClose = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsVisible(false);
    // Let the Zoom finish before telling the caller.
    window.setTimeout(() => onClose?.(), CLOSE_DELAY_MS);
  };

  const rawContent = badgeContentOf(resolved);
  const finalBadgeContent = buildBadgeContent({
    variant,
    size,
    icon,
    closable,
    dataTestId,
    baseContent: variant === 'count' ? formatCount(rawContent, { max, showZero }) : rawContent,
    onClose: handleClose });

  // A count that formatted away leaves nothing worth showing.
  const shouldBeInvisible =
    invisible || (variant === 'count' && finalBadgeContent === null && !showZero) || !isVisible;

  return (
    <BadgeSurface
      {...resolved}
      innerRef={ref}
      isVisible={isVisible}
      isAnimating={isAnimating}
      shouldBeInvisible={shouldBeInvisible}
      finalBadgeContent={finalBadgeContent}
      aria={definedAria({
        'aria-label': ariaLabel,
        'aria-live': ariaLive,
        'aria-atomic': ariaAtomic })}
      rest={props as unknown as Record<string, unknown>}
    />
  );
});

Badge.displayName = 'Badge';
