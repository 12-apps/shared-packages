'use client';

import type { CSSObject, Theme } from '@mui/material';
import { alpha,Typography } from '@mui/material';
import { styled } from '@mui/material';
import React from 'react';

import type { TextProps } from './Text.types';
import type { ColorValue } from '../../../tokens/scales';

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

const SIZE_MAP: Record<string, { fontSize: string; lineHeight: number }> = {
  xs: { fontSize: '0.75rem', lineHeight: 1.2 },
  sm: { fontSize: '0.875rem', lineHeight: 1.3 },
  md: { fontSize: '1rem', lineHeight: 1.5 },
  lg: { fontSize: '1.125rem', lineHeight: 1.4 },
  xl: { fontSize: '1.25rem', lineHeight: 1.3 },
};

const WEIGHT_MAP: Record<string, number> = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

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
        fontWeight: weight === 'normal' ? 600 : WEIGHT_MAP[weight],
        letterSpacing: '-0.01em',
      };
    case 'caption':
      return {
        ...base,
        fontSize: sizeOverride(a.customSize, '0.75rem'),
        opacity: 0.8,
        letterSpacing: '0.02em',
      };
    case 'code':
      return {
        ...base,
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", "Courier New", monospace',
        fontSize: sizeOverride(a.customSize, '0.875rem'),
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        padding: '2px 6px',
        borderRadius: theme.shape.borderRadius / 2,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
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
      ...props
    },
    ref,
  ) => (
      <StyledText
        ref={ref}
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
    ),
);

Text.displayName = 'Text';