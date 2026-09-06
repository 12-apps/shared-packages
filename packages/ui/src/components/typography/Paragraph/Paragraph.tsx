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
import { px } from '../../../tokens/theme';

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
const sizeMap: Record<string, { fontSize: string; lineHeight: number }> = Object.fromEntries(
  Object.entries(PARAGRAPH_SIZES).map(([size, step]) => [
    size,
    { fontSize: px(step.fontSize), lineHeight: step.lineHeight },
  ]),
);

// `lead` and `small` shrink or grow relative to the scale, but only at the
// default size — an explicit size wins.
const sizeOverride = (customSize: string, atDefault: number): string | undefined =>
  customSize === 'md' ? px(atDefault) : sizeMap[customSize]?.fontSize;

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
    ...sizeMap[customSize],
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
      fontSize: sizeOverride(customSize, LEAD_FONT_SIZE),
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
      fontSize: sizeOverride(customSize, SMALL_FONT_SIZE),
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
