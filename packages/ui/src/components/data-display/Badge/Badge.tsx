import CloseIcon from '@mui/icons-material/Close';
import { Badge as MuiBadge, IconButton, Zoom } from '@mui/material';
import { styled } from '@mui/material/styles';
import React, { useEffect,useState } from 'react';

import {
  badgeStyles,
  getAnchorOrigin,
  getSizeStyles,
} from './Badge.styles';
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
    ].includes(prop as string),
})<{
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
  hasIcon,
}) => {
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
    hasIcon,
  });
});


const CLOSE_ICON_SIZES: Record<BadgeSize, string> = {
  xs: '0.5rem',
  sm: '0.625rem',
  md: '0.75rem',
  lg: '0.875rem',
};

// Add icon if provided
const iconElement = ({
  icon,
  size,
  dataTestId,
}: {
  icon?: React.ReactNode;
  size: BadgeSize;
  dataTestId?: string;
}) =>
  icon ? (
    <span
      key="icon"
      data-testid={dataTestId ? `${dataTestId}-icon` : 'badge-icon'}
      style={{
        fontSize: getSizeStyles(size).iconSize,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {icon}
    </span>
  ) : null;

// Add main content
const contentElement = ({
  baseContent,
  dataTestId,
}: {
  baseContent: React.ReactNode;
  dataTestId?: string;
}) =>
  baseContent !== null && baseContent !== undefined ? (
    <span key="content" data-testid={dataTestId ? `${dataTestId}-content` : 'badge-content'}>
      {baseContent}
    </span>
  ) : null;

// Add close button if closable
const closeElement = ({
  closable,
  variant,
  size,
  dataTestId,
  onClose,
}: {
  closable?: boolean;
  variant: string;
  size: BadgeSize;
  dataTestId?: string;
  onClose: (e: React.MouseEvent) => void;
}) =>
  closable && !variant.includes('dot') ? (
    <IconButton
      key="close"
      size="small"
      onClick={onClose}
      data-testid={dataTestId ? `${dataTestId}-close` : 'badge-close'}
      sx={{
        p: 0,
        ml: 0.5,
        color: 'inherit',
        '& svg': { fontSize: CLOSE_ICON_SIZES[size] },
        '&:hover': { opacity: 0.8 },
      }}
    >
      <CloseIcon />
    </IconButton>
  ) : null;

// Icon, content and close button, assembled in order. Split out of the component
// so its branching does not count against the render.
const buildBadgeContent = ({
  variant,
  size,
  icon,
  closable,
  dataTestId,
  baseContent,
  onClose,
}: {
  variant: string;
  size: BadgeSize;
  icon?: React.ReactNode;
  closable?: boolean;
  dataTestId?: string;
  baseContent: React.ReactNode;
  onClose: (e: React.MouseEvent) => void;
}) => {
  if (variant === 'dot') return '';

  const contentElements = [
    iconElement({ icon, size, dataTestId }),
    contentElement({ baseContent, dataTestId }),
    closeElement({ closable, variant, size, dataTestId, onClose }),
  ].filter(Boolean);

  return contentElements.length > 0 ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
      {contentElements}
    </span>
  ) : null;
};

// Prop defaults live in these resolvers rather than the component's parameter
// list: fourteen `= default` branches would leave the render no budget of its
// own against the complexity gate.
type Look = Pick<BadgeProps, 'variant' | 'size' | 'color' | 'position'>;

const resolveLook = ({
  variant = 'default',
  size = 'md',
  color = 'primary',
  position = 'top-right',
}: Look) => ({ variant, size, color, position });

type Effects = Pick<BadgeProps, 'glow' | 'pulse' | 'animate' | 'shimmer' | 'bounce'>;

const resolveEffects = ({
  glow = false,
  pulse = false,
  animate = true,
  shimmer = false,
  bounce = false,
}: Effects) => ({ glow, pulse, animate, shimmer, bounce });

type Counting = Pick<BadgeProps, 'max' | 'showZero' | 'closable'>;

const resolveCounting = ({ max = 99, showZero = false, closable = false }: Counting) => ({
  max,
  showZero,
  closable,
});

// aria-* that carry no value are dropped rather than rendered empty.
const accessibilityProps = ({
  ariaLabel,
  ariaLive = 'polite',
  ariaAtomic = true,
}: {
  ariaLabel?: string;
  ariaLive?: string;
  ariaAtomic?: boolean;
}) =>
  Object.fromEntries(
    Object.entries({
      'aria-label': ariaLabel,
      'aria-live': ariaLive,
      'aria-atomic': ariaAtomic,
    }).filter(([, value]) => value !== undefined),
  );

// The count variant hides itself when it has nothing to count, which is not the
// same thing as the caller asking for it to be invisible.
const isInvisible = ({
  invisible,
  variant,
  content,
  showZero,
  isVisible,
}: {
  invisible?: boolean;
  variant: string;
  content: React.ReactNode;
  showZero: boolean;
  isVisible: boolean;
}) => invisible || (variant === 'count' && content === null && !showZero) || !isVisible;

// The mount animation is a one-shot: it runs for a second, then stops driving
// the styled badge.
const useAnimationFlag = (animate: boolean, bounce: boolean) => {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!animate && !bounce) return;

    setIsAnimating(true);
    const timer = window.setTimeout(() => setIsAnimating(false), 1000);

    return () => window.clearTimeout(timer);
  }, [animate, bounce]);

  return isAnimating;
};

// Determine the badge content; for the count variant, format numbers
const badgeValue = (
  { content, badgeContent }: Pick<BadgeProps, 'content' | 'badgeContent'>,
  { variant, max, showZero }: { variant: string; max: number; showZero: boolean },
): React.ReactNode => {
  const value = content ?? badgeContent ?? null;
  if (variant !== 'count' || typeof value !== 'number') return value;
  if (value === 0 && !showZero) return null;

  return value > max ? `${max}+` : value;
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant, size, color, glow, pulse, animate, shimmer, bounce, max, showZero,
      content, position, badgeContent, children, invisible, closable, onClose, icon,
      'aria-label': ariaLabel, 'aria-live': ariaLive, 'aria-atomic': ariaAtomic,
      'data-testid': dataTestId, className, ...props
    },
    ref,
  ) => {
    const look = resolveLook({ variant, size, color, position });
    const effects = resolveEffects({ glow, pulse, animate, shimmer, bounce });
    const counting = resolveCounting({ max, showZero, closable });
    const [isVisible, setIsVisible] = useState(true);
    const isAnimating = useAnimationFlag(effects.animate, effects.bounce);

    // Handle close action
    const handleClose = (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsVisible(false);
      window.setTimeout(() => onClose?.(), 300);
    };

    // Prepare badge content with icon and close button
    const finalBadgeContent = buildBadgeContent({
      variant: look.variant,
      size: look.size,
      icon,
      closable: counting.closable,
      dataTestId,
      baseContent: badgeValue({ content, badgeContent }, { ...counting, variant: look.variant }),
      onClose: handleClose,
    });

    return (
      <Zoom in={isVisible} timeout={300}>
        <StyledBadge
          ref={ref}
          className={className}
          customVariant={look.variant}
          customSize={look.size}
          customColor={look.color}
          glow={effects.glow}
          pulse={effects.pulse}
          animate={effects.animate}
          shimmer={effects.shimmer}
          bounce={effects.bounce && isAnimating}
          hasIcon={!!icon}
          badgeContent={finalBadgeContent}
          variant={look.variant === 'dot' ? 'dot' : 'standard'}
          anchorOrigin={getAnchorOrigin(look.position)}
          invisible={isInvisible({
            invisible,
            variant: look.variant,
            content: finalBadgeContent,
            showZero: counting.showZero,
            isVisible,
          })}
          data-testid={dataTestId || 'badge'}
          slotProps={{
            badge: {
              ...accessibilityProps({ ariaLabel, ariaLive, ariaAtomic }),
              // @ts-expect-error - MUI Badge slotProps doesn't include data-testid in types, but it works at runtime
              'data-testid': dataTestId ? `${dataTestId}-content-wrapper` : 'badge-content-wrapper',
            },
          }}
          {...props}
        >
          {children}
        </StyledBadge>
      </Zoom>
    );
  },
);

Badge.displayName = 'Badge';
