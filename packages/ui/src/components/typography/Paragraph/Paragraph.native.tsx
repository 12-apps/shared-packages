import * as React from 'react';
import { Text as RNText, type GestureResponderEvent, type TextStyle } from 'react-native';

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
import type { ParagraphProps, ParagraphVariant } from './Paragraph.types.native';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/** Same mapping as the web `getColorFromTheme`: neutral is body ink, every other colour its slot's main. */
const inkFor = (theme: UiTheme, color: ColorValue): string =>
  color === 'neutral' ? theme.palette.text.primary : theme.palette[color].main;

/** `lead` and `small` step up or down relative to the scale, but only at the default size. */
const sizeOverride = (size: SizeValue, atDefault: number): number =>
  size === 'md' ? atDefault : PARAGRAPH_SIZES[size].fontSize;

/** React Native wants the weight as a string. */
const WEIGHT = String(PARAGRAPH_FONT_WEIGHT) as TextStyle['fontWeight'];

export interface ParagraphStyleArgs {
  variant: ParagraphVariant;
  color: ColorValue;
  size: SizeValue;
}

/**
 * The style the web `Paragraph` computes, in absolute numbers. `lineHeight`,
 * `letterSpacing` and the `1em` bottom margin are multiplied out here because
 * React Native has no ratio or `em` unit — the web keeps them relative and the
 * browser does this step.
 */
export function paragraphStyle(theme: UiTheme, a: ParagraphStyleArgs): TextStyle {
  const step = PARAGRAPH_SIZES[a.size];
  const metrics = (fontSize: number, lineHeight: number): TextStyle => ({
    fontFamily: theme.typography.fontFamily,
    fontSize,
    lineHeight: fontSize * lineHeight,
    marginBottom: fontSize * PARAGRAPH_MARGIN_BOTTOM_EM,
    fontWeight: WEIGHT,
  });

  switch (a.variant) {
    case 'lead': {
      const fontSize = sizeOverride(a.size, LEAD_FONT_SIZE);
      return {
        ...metrics(fontSize, LEAD_LINE_HEIGHT),
        color: inkFor(theme, a.color),
        letterSpacing: LEAD_LETTER_SPACING_EM * fontSize,
      };
    }
    case 'muted':
      return {
        ...metrics(step.fontSize, step.lineHeight),
        color: theme.palette.text.secondary,
        opacity: MUTED_OPACITY,
      };
    case 'small':
      return {
        ...metrics(sizeOverride(a.size, SMALL_FONT_SIZE), SMALL_LINE_HEIGHT),
        color: theme.palette.text.secondary,
      };
    default:
      return { ...metrics(step.fontSize, step.lineHeight), color: inkFor(theme, a.color) };
  }
}

export const Paragraph = React.forwardRef<RNText, ParagraphProps>(
  ({ variant = 'default', color = 'neutral', size = 'md', children, style, onClick, onPress, ...others }, ref) => {
    const rest = withoutTestIdProps(others);
    const theme = useUiTheme();
    const resolved = React.useMemo(() => paragraphStyle(theme, { variant, color, size }), [theme, variant, color, size]);
    const handlePress =
      onClick || onPress
        ? (event: GestureResponderEvent): void => {
            onClick?.(event);
            onPress?.(event);
          }
        : undefined;

    return (
      <RNText ref={ref} style={[resolved, style]} testID={resolveTestId(others)} onPress={handlePress} {...rest}>
        {children}
      </RNText>
    );
  },
);

Paragraph.displayName = 'Paragraph';
