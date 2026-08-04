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

    const contentElements: React.ReactNode[] = [];

    // Add icon if provided
    if (icon) {
      const sizeStyles = getSizeStyles(size);
      contentElements.push(
        <span
          key="icon"
          data-testid={dataTestId ? `${dataTestId}-icon` : 'badge-icon'}
          style={{ fontSize: sizeStyles.iconSize, display: 'inline-flex', alignItems: 'center' }}
        >
          {icon}
        </span>,
      );
    }

    // Add main content
    if (baseContent !== null && baseContent !== undefined) {
      contentElements.push(
        <span key="content" data-testid={dataTestId ? `${dataTestId}-content` : 'badge-content'}>
          {baseContent}
        </span>,
      );
    }

    // Add close button if closable
    if (closable && !variant.includes('dot')) {
      const closeIconSize =
        size === 'xs'
          ? '0.5rem'
          : size === 'sm'
            ? '0.625rem'
            : size === 'md'
              ? '0.75rem'
              : '0.875rem';
      contentElements.push(
        <IconButton
          key="close"
          size="small"
          onClick={onClose}
          data-testid={dataTestId ? `${dataTestId}-close` : 'badge-close'}
          sx={{
            p: 0,
            ml: 0.5,
            color: 'inherit',
            '& svg': { fontSize: closeIconSize },
            '&:hover': { opacity: 0.8 },
          }}
        >
          <CloseIcon />
        </IconButton>,
      );
    }

    return contentElements.length > 0 ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
        {contentElements}
      </span>
    ) : null;
  
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = 'default',
      size = 'md',
      color = 'primary',
      glow = false,
      pulse = false,
      animate = true,
      shimmer = false,
      bounce = false,
      max = 99,
      showZero = false,
      content,
      position = 'top-right',
      badgeContent,
      children,
      invisible,
      closable = false,
      onClose,
      icon,
      'aria-label': ariaLabel,
      'aria-live': ariaLive = 'polite',
      'aria-atomic': ariaAtomic = true,
      'data-testid': dataTestId,
      className,
      ...props
    },
    ref,
  ) => {
    const [isVisible, setIsVisible] = useState(true);
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
      if (animate || bounce) {
        setIsAnimating(true);
        const timer = window.setTimeout(() => setIsAnimating(false), 1000);
        return () => window.clearTimeout(timer);
      }
    }, [animate, bounce]);

    // Determine the badge content
    const getBadgeContent = () => {
      if (content !== undefined) return content;
      if (badgeContent !== undefined) return badgeContent;
      return null;
    };

    // For count variant, format numbers
    const formatCount = (count: React.ReactNode): React.ReactNode => {
      if (typeof count === 'number') {
        if (count === 0 && !showZero) return null;
        if (count > max) return `${max}+`;
        return count;
      }
      return count;
    };

    // Handle close action
    const handleClose = (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsVisible(false);
      window.setTimeout(() => {
        onClose?.();
      }, 300);
    };

    // Prepare badge content with icon and close button
    const prepareBadgeContent = () =>
      buildBadgeContent({
        variant,
        size,
        icon,
        closable,
        dataTestId,
        baseContent: variant === 'count' ? formatCount(getBadgeContent()) : getBadgeContent(),
        onClose: handleClose,
      });

    const finalBadgeContent = prepareBadgeContent();
    const anchorOrigin = getAnchorOrigin(position);

    // Determine if badge should be invisible
    const shouldBeInvisible =
      invisible || (variant === 'count' && finalBadgeContent === null && !showZero) || !isVisible;

    // Build accessibility props
    const accessibilityProps: Record<string, string | boolean | undefined> = {
      'aria-label': ariaLabel,
      'aria-live': ariaLive,
      'aria-atomic': ariaAtomic,
    };

    // Remove undefined values
    Object.keys(accessibilityProps).forEach((key) => {
      if (accessibilityProps[key] === undefined) {
        delete accessibilityProps[key];
      }
    });

    return (
      <Zoom in={isVisible} timeout={300}>
        <StyledBadge
          ref={ref}
          className={className}
          customVariant={variant}
          customSize={size}
          customColor={color}
          glow={glow}
          pulse={pulse}
          animate={animate}
          shimmer={shimmer}
          bounce={bounce && isAnimating}
          hasIcon={!!icon}
          badgeContent={finalBadgeContent}
          variant={variant === 'dot' ? 'dot' : 'standard'}
          anchorOrigin={anchorOrigin}
          invisible={shouldBeInvisible}
          data-testid={dataTestId || 'badge'}
          slotProps={{
            badge: {
              ...accessibilityProps,
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
