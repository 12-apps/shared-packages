import MuiTooltip from "@mui/material/Tooltip/index.js";
import type { CSSObject, Theme } from "@mui/material/styles/index.js";
import React from "react";

import {
  resolveTooltipProps,
  useHoverOpen,
  usePinnedTooltip,
} from "./InteractiveTooltip.hooks";
import {
  arrowColor,
  emphasisStyles,
  getSizeStyles,
  tooltipCap,
  variantStyles,
} from "./InteractiveTooltip.styles";
import type { InteractiveTooltipProps } from "./InteractiveTooltip.types";

/**
 * The bubble's own look, applied to the BUBBLE (FUT-3093) — see `Tooltip`'s
 * `bubbleSx`: a `& .MuiTooltip-tooltip` rule on the root never reached the
 * portalled bubble, so the variants had never been on screen.
 */
const bubbleSx =
  (
    variant: string | undefined,
    size: string | undefined,
    glow: boolean | undefined,
    pulse: boolean | undefined,
    maxWidth: number | undefined,
  ) =>
  (theme: Theme): CSSObject => {
    const sizeStyles = getSizeStyles(size);
    return {
      borderRadius: theme.spacing(1),
      fontSize: sizeStyles.fontSize(theme),
      padding: sizeStyles.padding(theme),
      fontWeight: 500,
      transition: "all 0.3s ease",
      position: "relative",
      maxWidth: tooltipCap(maxWidth)(theme),
      ...variantStyles(theme, variant),
      ...emphasisStyles(theme, glow, pulse),
    };
  };

export const InteractiveTooltip = React.forwardRef<
  HTMLDivElement,
  InteractiveTooltipProps
>((rawProps, ref) => {
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

  const { isPinned, isControlledOpen, wrapperRef, handleClick } =
    usePinnedTooltip({
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
    "data-testid"?: string;
  }>;

  const childWithProps = React.cloneElement(childElement, {
    onClick: (e: React.MouseEvent) => {
      handleClick(e);
      // Call original onClick if it exists
      childElement.props.onClick?.(e);
    },
    "data-testid": dataTestId ? `${dataTestId}-trigger` : undefined,
  });

  return (
    <div ref={wrapperRef} className={className}>
      <MuiTooltip
        ref={ref}
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
            sx: bubbleSx(variant, size, glow, pulse, maxWidth),
            role: "tooltip",
            ...(dataTestId && { "data-testid": `${dataTestId}-content` }),
          },
          arrow: {
            sx: (theme: Theme) => ({ color: arrowColor(theme, variant) }),
          },
        }}
        {...props}
      >
        {childWithProps}
      </MuiTooltip>
    </div>
  );
});

InteractiveTooltip.displayName = "InteractiveTooltip";
