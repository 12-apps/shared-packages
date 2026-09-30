import MuiTooltip from "@mui/material/Tooltip/index.js";
import { alpha, keyframes } from "@mui/material/styles/index.js";
import type { CSSObject, Theme } from "@mui/material/styles/index.js";
import React from "react";

import type { TooltipProps } from "./Tooltip.types";
import { absoluteInk, neutralTones } from "../../../tokens/ink";
import { rem, rems, sxRem } from "../../../tokens/relative";

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const SIZE_MAP = {
  sm: { fontSize: sxRem(12), padding: (theme: Theme) => rems(theme, 4, 8) },
  md: { fontSize: sxRem(14), padding: (theme: Theme) => rems(theme, 6, 12) },
  lg: { fontSize: sxRem(16), padding: (theme: Theme) => rems(theme, 8, 16) },
} as const;

const getSizeStyles = (
  size?: string,
): { fontSize: (theme: Theme) => string; padding: (theme: Theme) => string } =>
  SIZE_MAP[size as keyof typeof SIZE_MAP] || SIZE_MAP.md;

const variantStyles = (theme: Theme, variant?: string): CSSObject => {
  switch (variant) {
    case "default":
      return {
        backgroundColor: neutralTones(theme).inverseSurface,
        color: absoluteInk(theme).white,
      };
    case "dark":
      return {
        backgroundColor: neutralTones(theme).inverseSurface,
        color: absoluteInk(theme).white,
      };
    case "light":
      return {
        backgroundColor: absoluteInk(theme).white,
        color: theme.palette.text.primary,
        border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        boxShadow: theme.shadows[4],
      };
    case "glass":
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: `blur(${rem(theme, 20)})`,
        border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        color: theme.palette.text.primary,
      };
    default:
      return {};
  }
};

// glow and pulse are independent flags. The three combinations used to be spelled
// out one by one, but each is just the union of whichever flags are set.
const emphasisStyles = (
  theme: Theme,
  glow?: boolean,
  pulse?: boolean,
): CSSObject => ({
  ...(glow && {
    boxShadow: `${rems(theme, 0, 0, 15, 3)} ${alpha(theme.palette.primary.main, 0.4)} !important`,
    filter: "brightness(1.05)",
  }),
  ...(pulse && {
    animation: `${pulseAnimation} 2s infinite`,
  }),
});

const arrowColor = (theme: Theme, variant?: string): string => {
  switch (variant) {
    case "light":
      return absoluteInk(theme).white;
    case "glass":
      return alpha(theme.palette.background.paper, 0.1);
    case "dark":
      return neutralTones(theme).inverseSurface;
    default:
      return neutralTones(theme).inverseSurface;
  }
};

/**
 * The bubble's own look, applied to the BUBBLE (FUT-3093).
 *
 * It used to sit on a `styled(MuiTooltip)` root as `& .MuiTooltip-tooltip`, but
 * MUI renders the bubble in a portal, outside that root — so none of it ever
 * reached the screen, and every tooltip wore MUI's see-through grey instead of
 * the variant it asked for. `slotProps.tooltip.sx` lands on the bubble itself.
 * No `overflow: hidden`: now that it applies, it would clip an `arrow`.
 */
const bubbleSx =
  (
    variant: string,
    size: string,
    glow: boolean,
    pulse: boolean,
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

/**
 * The tooltip's cap: 300 design px unless the caller says otherwise. `sx` has
 * always read a number of 1 or less as a fraction of the parent, and that stays so.
 */
const tooltipCap =
  (maxWidth: number | undefined) =>
  (theme: Theme): string => {
    const cap = maxWidth ?? 300;
    return cap <= 1 && cap !== 0 ? `${cap * 100}%` : rem(theme, cap);
  };

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  (
    {
      variant = "default",
      size = "md",
      glow = false,
      pulse = false,
      maxWidth,
      dataTestId,
      children,
      ...props
    },
    ref,
  ) => {
    const childWithTestId = dataTestId
      ? React.cloneElement(
          children as React.ReactElement<{ "data-testid"?: string }>,
          {
            "data-testid": `${dataTestId}-trigger`,
          },
        )
      : children;

    return (
      <MuiTooltip
        ref={ref}
        enterDelay={0}
        leaveDelay={0}
        disableHoverListener={false}
        disableFocusListener={false}
        disableTouchListener={false}
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
        {childWithTestId}
      </MuiTooltip>
    );
  },
);

Tooltip.displayName = "Tooltip";
