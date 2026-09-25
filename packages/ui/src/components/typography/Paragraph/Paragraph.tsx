import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import Typography from '@mui/material/Typography/index.js';
import { styled } from '@mui/material/styles/index.js';
import React from 'react';

import {
  LEAD_FONT_SIZE,
  LEAD_LETTER_SPACING_EM,
  LEAD_LINE_HEIGHT,
  MUTED_OPACITY,
  PARAGRAPH_FONT_WEIGHT,
  PARAGRAPH_MARGIN_BOTTOM_EM,
  PARAGRAPH_SIZES,
  SMALL_FONT_SIZE,
  SMALL_LINE_HEIGHT,
} from './Paragraph.metrics';
import type { ParagraphProps } from './Paragraph.types';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { rem } from '../../../tokens/relative';
import type { UiTypeStep } from '../../../tokens/theme';

const getColorFromTheme = (theme: Theme, color: string) => {
  if (color === 'neutral') {
    return theme.palette.text.primary;
  }

  const colorMap: Record<string, string> = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    info: theme.palette.info.main,
    danger: theme.palette.error.main,
  };

  return colorMap[color] || theme.palette.text.primary;
};

// Derived from the shared metrics, not restated: the native `Paragraph` reads
// the same table, so the two renderers cannot disagree on a size.
// The table keeps the design px; the size is converted where it is read.
const sizeMap: Readonly<Record<string, UiTypeStep | undefined>> = PARAGRAPH_SIZES;

const sizeStyles = (theme: Theme, customSize: string): CSSObject => {
  const step = sizeMap[customSize];
  return step ? { fontSize: rem(theme, step.fontSize), lineHeight: step.lineHeight } : {};
};

// `lead` and `small` shrink or grow relative to the scale, but only at the
// default size — an explicit size wins.
const sizeOverride = (theme: Theme, customSize: string, atDefault: number): string | undefined => {
  const drawnAt = customSize === 'md' ? atDefault : sizeMap[customSize]?.fontSize;
  return drawnAt === undefined ? undefined : rem(theme, drawnAt);
};

const StyledParagraph = styled(Typography, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customColor', 'customSize'].includes(prop as string),
})<{
  customVariant?: string;
  customColor?: string;
  customSize?: string;
}>(({ theme, customVariant = 'default', customColor = 'neutral', customSize = 'md' }) => {
  const textColor = getColorFromTheme(theme, customColor);

  const baseStyles: CSSObject = {
    fontFamily: theme.typography.body1.fontFamily,
    margin: `0 0 ${PARAGRAPH_MARGIN_BOTTOM_EM}em 0`,
    transition: 'all 0.2s ease',
    ...sizeStyles(theme, customSize),
  };

  // Variant-specific styles
  const variantStyles: Record<string, CSSObject> = {
    default: {
      ...baseStyles,
      color: textColor,
      fontWeight: PARAGRAPH_FONT_WEIGHT,
    },
    lead: {
      ...baseStyles,
      color: textColor,
      fontWeight: PARAGRAPH_FONT_WEIGHT,
      fontSize: sizeOverride(theme, customSize, LEAD_FONT_SIZE),
      lineHeight: LEAD_LINE_HEIGHT,
      letterSpacing: `${LEAD_LETTER_SPACING_EM}em`,
    },
    muted: {
      ...baseStyles,
      color: theme.palette.text.secondary,
      fontWeight: PARAGRAPH_FONT_WEIGHT,
      opacity: MUTED_OPACITY,
    },
    small: {
      ...baseStyles,
      color: theme.palette.text.secondary,
      fontSize: sizeOverride(theme, customSize, SMALL_FONT_SIZE),
      fontWeight: PARAGRAPH_FONT_WEIGHT,
      lineHeight: SMALL_LINE_HEIGHT,
    },
  };

  return variantStyles[customVariant] || variantStyles.default;
});

export const Paragraph = React.forwardRef<globalThis.HTMLParagraphElement, ParagraphProps>(
  ({ variant = 'default', color = 'neutral', size = 'md', children, ...others }, ref) => {
    // `testID` and `dataTestId` are the shared contract's spellings; the DOM
    // wants `data-testid`, and must not see the other two as attributes.
    const testId = resolveTestId(others);
    const props = withoutTestIdProps(others);
    return (
      <StyledParagraph
        ref={ref}
        data-testid={testId}
        customVariant={variant}
        customColor={color}
        customSize={size}
        {...props}
      >
        {children}
      </StyledParagraph>
    );
  },
);

Paragraph.displayName = 'Paragraph';
