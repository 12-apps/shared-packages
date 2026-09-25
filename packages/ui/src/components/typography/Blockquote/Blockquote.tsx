import FormatQuote from '@mui/icons-material/FormatQuote';
import type { Theme } from '@mui/material/styles/index.js';
import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import React from 'react';

import type { BlockquoteProps } from './Blockquote.types';
import { absoluteInk, controlNeutral, neutralTones } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';

const getColorFromTheme = (theme: Theme, color: string) => {
  if (color === 'neutral') {
    const { main, light, dark } = controlNeutral(theme);
    return { main, light, dark };
  }

  const colorMap: Record<string, typeof theme.palette.primary> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    danger: theme.palette.error,
  };

  return colorMap[color] || theme.palette.primary;
};

const StyledBlockquote = styled('blockquote', {
  shouldForwardProp: (prop) => !['customVariant', 'customColor'].includes(prop as string),
})<{
  customVariant?: string;
  customColor?: string;
}>(({ theme, customVariant = 'default', customColor = 'neutral' }) => {
  const colorPalette = getColorFromTheme(theme, customColor);

  const baseStyles = {
    margin: '1.5em 0',
    padding: 0,
    position: 'relative' as const,
    fontFamily: theme.typography.body1.fontFamily,
    fontSize: rem(theme, 18),
    lineHeight: 1.6,
    fontStyle: 'italic',
    color: theme.palette.text.primary,
  };

  // Return styles based on variant
  if (customVariant === 'bordered') {
    return {
      ...baseStyles,
      padding: theme.spacing(3),
      border: `${rem(theme, 2)} solid ${alpha(colorPalette.main, 0.2)}`,
      borderRadius: theme.shape.borderRadius * 2,
      backgroundColor: alpha(colorPalette.main, 0.03),
      '&::before': {
        content: '""',
        position: 'absolute',
        top: rem(theme, -1),
        left: rem(theme, -1),
        right: rem(theme, -1),
        bottom: rem(theme, -1),
        background: `linear-gradient(135deg, ${colorPalette.main}, ${colorPalette.light})`,
        borderRadius: theme.shape.borderRadius * 2,
        padding: rem(theme, 2),
        WebkitMask: `linear-gradient(${absoluteInk(theme).white} 0 0) content-box, linear-gradient(${absoluteInk(theme).white} 0 0)`,
        WebkitMaskComposite: 'exclude',
        mask: `linear-gradient(${absoluteInk(theme).white} 0 0) content-box, linear-gradient(${absoluteInk(theme).white} 0 0)`,
        maskComposite: 'exclude',
      },
    };
  }

  if (customVariant === 'citation') {
    return {
      ...baseStyles,
      padding: theme.spacing(2, 3),
      backgroundColor:
        theme.palette.mode === 'dark'
          ? alpha(theme.palette.background.paper, 0.8)
          : alpha(neutralTones(theme).canvas, 0.95),
      backdropFilter: theme.palette.mode === 'dark' ? `blur(${rem(theme, 10)})` : 'none',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
      borderRadius: theme.shape.borderRadius * 2,
      boxShadow: theme.palette.mode === 'dark' ? theme.shadows[4] : 'none',
      textAlign: 'center' as const,
    };
  }

  // Default variant
  return {
    ...baseStyles,
    paddingLeft: theme.spacing(3),
    borderLeft: `${rem(theme, 4)} solid ${colorPalette.main}`,
    backgroundColor: alpha(colorPalette.main, 0.05),
    padding: theme.spacing(2, 3),
    borderRadius: theme.shape.borderRadius,
  };
});

const QuoteIcon = styled(FormatQuote)<{ customColor: string }>(({ theme, customColor }) => {
  const colorPalette = getColorFromTheme(theme, customColor);
  
  return {
    position: 'absolute',
    top: theme.spacing(1),
    left: theme.spacing(1),
    fontSize: rem(theme, 32),
    opacity: 0.3,
    transform: 'rotate(180deg)',
    color: colorPalette.main,
  };
});

const CitationContainer = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(2),
  textAlign: 'right',
  fontStyle: 'normal',
  opacity: 0.8,
}));

const AuthorName = styled(Typography)(({ theme }) => ({
  fontWeight: 600,
  fontSize: rem(theme, 14),
  marginBottom: theme.spacing(0.5),
}));

const SourceName = styled(Typography)(({ theme }) => ({
  fontSize: rem(theme, 12),
  opacity: 0.7,
}));

export const Blockquote = React.forwardRef<globalThis.HTMLQuoteElement, BlockquoteProps>(
  ({ variant = 'default', author, source, color = 'neutral', children, ...props }, ref) => {
    const showCitation = author || source;
    const showIcon = variant === 'bordered' || variant === 'citation';

    return (
      <StyledBlockquote ref={ref} customVariant={variant} customColor={color} {...props}>
        {showIcon && <QuoteIcon customColor={color} />}

        <Typography
          component="div"
          sx={{
            fontSize: 'inherit',
            lineHeight: 'inherit',
            fontStyle: 'inherit',
            color: 'inherit',
            margin: 0,
          }}
        >
          {children}
        </Typography>

        {showCitation && (
          <CitationContainer>
            {author && <AuthorName>— {author}</AuthorName>}
            {source && <SourceName>{source}</SourceName>}
          </CitationContainer>
        )}
      </StyledBlockquote>
    );
  },
);

Blockquote.displayName = 'Blockquote';