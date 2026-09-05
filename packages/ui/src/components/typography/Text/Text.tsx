'use client';

import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import React from 'react';

import {
  CAPTION_FONT_SIZE,
  CAPTION_LETTER_SPACING_EM,
  CAPTION_OPACITY,
  CODE_BACKGROUND_ALPHA,
  CODE_BORDER_ALPHA,
  CODE_FONT_SIZE,
  CODE_PADDING,
  CODE_RADIUS_FACTOR,
  HEADING_DEFAULT_WEIGHT,
  HEADING_LETTER_SPACING_EM,
  TEXT_SIZES,
  TEXT_WEIGHTS,
} from './Text.metrics';
import type { TextProps } from './Text.types';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import type { ColorValue } from '../../../tokens/scales';
import { px } from '../../../tokens/theme';

const getColorFromTheme = (theme: Theme, color: ColorValue): string => {
  if (color === 'neutral') {
    return theme.palette.text.primary;
  }

  if (color === 'secondary') {
    return theme.palette.text.secondary;
  }

  // Exhaustive over ColorValue on purpose. It was a partial `Record<string, …>`
  // with a silent `|| text.primary` fallback, so `info` — accepted by the type
  // — rendered as ordinary body text. Typing the key means a colour added to
  // the vocabulary cannot reach here without a home.
  const colorMap: Record<Exclude<ColorValue, 'neutral' | 'secondary'>, string> = {
    primary: theme.palette.primary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    info: theme.palette.info.main,
    danger: theme.palette.error.main,
  };

  return colorMap[color];
};

// Derived from the shared metrics, not restated: the native `Text` reads the
// same table, so the two renderers cannot disagree on a size.
const SIZE_MAP: Record<string, { fontSize: string; lineHeight: number }> = Object.fromEntries(
  Object.entries(TEXT_SIZES).map(([size, step]) => [
    size,
    { fontSize: px(step.fontSize), lineHeight: step.lineHeight },
  ]),
);

const WEIGHT_MAP: Record<string, number> = TEXT_WEIGHTS;

interface TextStyleArgs {
  theme: Theme;
  customVariant?: string;
  customColor?: ColorValue;
  customSize?: string;
  customWeight?: string;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

// underline and strikethrough combine into one declaration rather than one
// winning over the other.
const decorationFor = (underline?: boolean, strikethrough?: boolean): string =>
  [underline && 'underline', strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none';

const baseTextStyles = (theme: Theme, a: TextStyleArgs): CSSObject => ({
  color: getColorFromTheme(theme, a.customColor ?? 'neutral'),
  fontSize: SIZE_MAP[a.customSize ?? 'md']?.fontSize,
  lineHeight: SIZE_MAP[a.customSize ?? 'md']?.lineHeight,
  fontWeight: WEIGHT_MAP[a.customWeight ?? 'normal'],
  fontStyle: a.italic ? 'italic' : 'normal',
  textDecoration: decorationFor(a.underline, a.strikethrough),
  transition: 'all 0.2s ease',
});

// Captions and code shrink relative to the body scale, but only at the default
// size — an explicit size wins.
const sizeOverride = (customSize: string | undefined, atDefault: string): string | undefined =>
  (customSize ?? 'md') === 'md' ? atDefault : SIZE_MAP[customSize ?? 'md']?.fontSize;

const textVariantStyles = (theme: Theme, a: TextStyleArgs, base: CSSObject): CSSObject => {
  const weight = a.customWeight ?? 'normal';

  switch (a.customVariant) {
    case 'heading':
      return {
        ...base,
        fontFamily: theme.typography.h4.fontFamily,
        fontWeight: weight === 'normal' ? HEADING_DEFAULT_WEIGHT : WEIGHT_MAP[weight],
        letterSpacing: `${HEADING_LETTER_SPACING_EM}em`,
      };
    case 'caption':
      return {
        ...base,
        fontSize: sizeOverride(a.customSize, px(CAPTION_FONT_SIZE)),
        opacity: CAPTION_OPACITY,
        letterSpacing: `${CAPTION_LETTER_SPACING_EM}em`,
      };
    case 'code':
      return {
        ...base,
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", "Courier New", monospace',
        fontSize: sizeOverride(a.customSize, px(CODE_FONT_SIZE)),
        backgroundColor: alpha(theme.palette.primary.main, CODE_BACKGROUND_ALPHA),
        padding: `${CODE_PADDING.vertical}px ${CODE_PADDING.horizontal}px`,
        borderRadius: theme.shape.borderRadius * CODE_RADIUS_FACTOR,
        border: `1px solid ${alpha(theme.palette.primary.main, CODE_BORDER_ALPHA)}`,
      };
    default:
      return { ...base, fontFamily: theme.typography.body1.fontFamily };
  }
};

const StyledText = styled(Typography, {
  shouldForwardProp: (prop) =>
    ![
      'customVariant',
      'customColor',
      'customSize',
      'customWeight',
      'italic',
      'underline',
      'strikethrough',
    ].includes(prop as string),
})<{
  customVariant?: string;
  customColor?: ColorValue;
  customSize?: string;
  customWeight?: string;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}>((args) => {
  const { theme } = args;
  return textVariantStyles(theme, args, baseTextStyles(theme, args));
});

export const Text = React.forwardRef<HTMLElement, TextProps>(
  (
    {
      variant = 'body',
      color = 'neutral',
      size = 'md',
      weight = 'normal',
      as = 'span',
      italic = false,
      underline = false,
      strikethrough = false,
      children,
      ...others
    },
    ref,
  ) => {
    // `testID` and `dataTestId` are the shared contract's spellings; the DOM
    // wants `data-testid`, and must not see the other two as attributes.
    const testId = resolveTestId(others);
    const props = withoutTestIdProps(others);
    return (
      <StyledText
        ref={ref}
        data-testid={testId}
        customVariant={variant}
        customColor={color}
        customSize={size}
        customWeight={weight}
        italic={italic}
        underline={underline}
        strikethrough={strikethrough}
        {...(as && { as })}
        {...props}
      >
        {children}
      </StyledText>
    );
  },
);

Text.displayName = 'Text';