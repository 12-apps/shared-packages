import * as React from 'react';
import { Platform, Text as RNText, type TextStyle } from 'react-native';

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
import type { TextProps, TextVariant, TextWeight } from './Text.types.native';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';
import { alpha } from '../../../tokens/color';
import type { UiTheme } from '../../../tokens/theme';

/** Same mapping as the web `getColorFromTheme`: neutral is body ink, secondary the muted ink. */
const inkFor = (theme: UiTheme, color: ColorValue): string => {
  if (color === 'neutral') return theme.palette.text.primary;
  if (color === 'secondary') return theme.palette.text.secondary;
  return theme.palette[color].main;
};

/** React Native wants the weight as a string. */
const weightOf = (weight: number): TextStyle['fontWeight'] => String(weight) as TextStyle['fontWeight'];

/** Captions and code shrink relative to the body scale, but only at the default size. */
const sizeOverride = (size: SizeValue, atDefault: number): number =>
  size === 'md' ? atDefault : TEXT_SIZES[size].fontSize;

const decoration = (underline: boolean, strikethrough: boolean): TextStyle['textDecorationLine'] => {
  if (underline && strikethrough) return 'underline line-through';
  if (underline) return 'underline';
  return strikethrough ? 'line-through' : 'none';
};

interface TextStyleArgs {
  variant: TextVariant;
  color: ColorValue;
  size: SizeValue;
  weight: TextWeight;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

const monospace = (theme: UiTheme): string | undefined =>
  theme.typography.monospaceFontFamily ?? Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/**
 * The style the web `Text` computes, in absolute numbers. `lineHeight` and
 * `letterSpacing` are multiplied out here because React Native has no ratio
 * or `em` unit — the web keeps them relative and the browser does this step.
 */
export function textStyle(theme: UiTheme, a: TextStyleArgs): TextStyle {
  const step = TEXT_SIZES[a.size];
  const base: TextStyle = {
    color: inkFor(theme, a.color),
    fontFamily: theme.typography.fontFamily,
    fontSize: step.fontSize,
    lineHeight: step.fontSize * step.lineHeight,
    fontWeight: weightOf(TEXT_WEIGHTS[a.weight]),
    fontStyle: a.italic ? 'italic' : 'normal',
    textDecorationLine: decoration(a.underline, a.strikethrough),
  };

  switch (a.variant) {
    case 'heading':
      return {
        ...base,
        fontWeight: weightOf(a.weight === 'normal' ? HEADING_DEFAULT_WEIGHT : TEXT_WEIGHTS[a.weight]),
        letterSpacing: HEADING_LETTER_SPACING_EM * step.fontSize,
      };
    case 'caption': {
      const fontSize = sizeOverride(a.size, CAPTION_FONT_SIZE);
      return {
        ...base,
        fontSize,
        lineHeight: fontSize * step.lineHeight,
        opacity: CAPTION_OPACITY,
        letterSpacing: CAPTION_LETTER_SPACING_EM * fontSize,
      };
    }
    case 'code': {
      const fontSize = sizeOverride(a.size, CODE_FONT_SIZE);
      return {
        ...base,
        fontFamily: monospace(theme),
        fontSize,
        lineHeight: fontSize * step.lineHeight,
        backgroundColor: alpha(theme.palette.primary.main, CODE_BACKGROUND_ALPHA),
        paddingVertical: CODE_PADDING.vertical,
        paddingHorizontal: CODE_PADDING.horizontal,
        borderRadius: theme.radius.md * CODE_RADIUS_FACTOR,
        borderWidth: 1,
        borderColor: alpha(theme.palette.primary.main, CODE_BORDER_ALPHA),
      };
    }
    default:
      return base;
  }
}

export const Text = React.forwardRef<RNText, TextProps>(
  (
    {
      variant = 'body',
      color = 'neutral',
      size = 'md',
      weight = 'normal',
      italic = false,
      underline = false,
      strikethrough = false,
      children,
      style,
      ...others
    },
    ref,
  ) => {
    const rest = withoutTestIdProps(others);
    const theme = useUiTheme();
    const resolved = React.useMemo(
      () => textStyle(theme, { variant, color, size, weight, italic, underline, strikethrough }),
      [theme, variant, color, size, weight, italic, underline, strikethrough],
    );

    return (
      <RNText
        ref={ref}
        style={[resolved, style]}
        testID={resolveTestId(others)}
        role={variant === 'heading' ? 'heading' : undefined}
        {...rest}
      >
        {children}
      </RNText>
    );
  },
);

Text.displayName = 'Text';
