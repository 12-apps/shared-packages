import MuiTooltip from '@mui/material/Tooltip/index.js';
import { styled } from '@mui/material/styles/index.js';
import React from 'react';

import { resolveTooltipProps, useHoverOpen, usePinnedTooltip } from './InteractiveTooltip.hooks';
import {
  arrowColor,
  emphasisStyles,
  getSizeStyles,
  tooltipCap,
  variantStyles,
} from './InteractiveTooltip.styles';
import type { InteractiveTooltipProps } from './InteractiveTooltip.types';

const StyledTooltip = styled(MuiTooltip, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customSize', 'glow', 'pulse'].includes(prop as string),
})<{
  customVariant?: string;
  customSize?: string;
  glow?: boolean;
  pulse?: boolean;
}>(({ theme, customVariant, customSize, glow, pulse }) => {
  const sizeStyles = getSizeStyles(customSize);

  return {
    '& .MuiTooltip-tooltip': {
      borderRadius: theme.spacing(1),
      fontSize: sizeStyles.fontSize(theme),
      padding: sizeStyles.padding(theme),
      fontWeight: 500,
      transition: 'all 0.3s ease',
      position: 'relative',
      overflow: 'hidden',
      ...variantStyles(theme, customVariant),
      ...emphasisStyles(theme, glow, pulse),
    },

    '& .MuiTooltip-arrow': {
      color: arrowColor(theme, customVariant),
    },
  };
});

export const InteractiveTooltip = React.forwardRef<HTMLDivElement, InteractiveTooltipProps>(
  (rawProps, ref) => {
    const {
      variant,
      size,
      glow,
      pulse,
      maxWidth,
      dataTestId,
      hoverContent,
      pinnedContent,
      clickable,
      onPin,
      onUnpin,
      className,
      children,
      onOpen,
      onClose,
      ...props
    } = resolveTooltipProps(rawProps);

    const { isPinned, isControlledOpen, wrapperRef, handleClick } = usePinnedTooltip({
      clickable,
      onPin,
      onUnpin,
    });
    const hover = useHoverOpen(isPinned, onOpen, onClose);

    // Determine which content to show
    const tooltipContent = isPinned ? pinnedContent : hoverContent;

    // Child with click handler and ref
    const childElement = children as React.ReactElement<{
      onClick?: (e: React.MouseEvent) => void;
      'data-testid'?: string;
    }>;

    const childWithProps = React.cloneElement(childElement, {
      onClick: (e: React.MouseEvent) => {
        handleClick(e);
        // Call original onClick if it exists
        childElement.props.onClick?.(e);
      },
      'data-testid': dataTestId ? `${dataTestId}-trigger` : undefined,
    });

    return (
      <div ref={wrapperRef} className={className}>
        <StyledTooltip
          ref={ref}
          customVariant={variant}
          customSize={size}
          glow={glow}
          pulse={pulse}
          title={tooltipContent}
          open={isPinned ? isControlledOpen : hover.open}
          onOpen={hover.onOpen}
          onClose={hover.onClose}
          enterDelay={isPinned ? 0 : 100}
          leaveDelay={0}
          disableHoverListener={isPinned}
          disableFocusListener={isPinned}
          disableTouchListener={isPinned}
          slotProps={{
            tooltip: {
              sx: { maxWidth: tooltipCap(maxWidth) },
              role: 'tooltip',
              ...(dataTestId && { 'data-testid': `${dataTestId}-content` }),
            },
          }}
          {...props}
        >
          {childWithProps}
        </StyledTooltip>
      </div>
    );
  },
);

InteractiveTooltip.displayName = 'InteractiveTooltip';
