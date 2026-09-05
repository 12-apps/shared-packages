import * as React from 'react';
import { Text as RNText, type GestureResponderEvent, type TextStyle } from 'react-native';

import type { HeadingWeight } from './Heading.base';
import {
  HEADING_DEFAULT_COLOR,
  HEADING_DEFAULT_LEVEL,
  HEADING_DEFAULT_WEIGHT,
  HEADING_RANK,
  headingGradientStops,
  headingWeight,
  stepOf,
} from './Heading.metrics';
import type { HeadingProps } from './Heading.types.native';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { HeadingLevel } from '../../../tokens/heading-scale';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/** Same mapping as the web `getColorFromTheme`: neutral is body ink, every other colour its slot's main. */
const inkFor = (theme: UiTheme, color: ColorValue): string =>
  color === 'neutral' ? theme.palette.text.primary : theme.palette[color].main;

export interface HeadingStyleArgs {
  /** The step to DRAW — `size ?? level`, already resolved to a name the scale has. */
  size: HeadingLevel;
  color: ColorValue;
  weight: HeadingWeight;
  gradient: boolean;
}

/**
 * The style the web `headingSx` computes, in absolute numbers. The step comes
 * from the theme's heading scale (`HEADING_SCALE` unless the host built its
 * own), and its `lineHeight` ratio and `letterSpacing` em are multiplied out
 * because React Native has neither unit.
 *
 * `gradient` is the one honest gap: React Native has no `background-clip:
 * text` and no gradient fill in core, so the glyphs take the gradient's first
 * stop as a flat colour — the same choice the native `Button` makes.
 */
export function headingStyle(theme: UiTheme, a: HeadingStyleArgs): TextStyle {
  const step = theme.typography.heading[a.size];
  return {
    fontFamily: theme.typography.fontFamily,
    fontSize: step.fontSize,
    lineHeight: step.fontSize * step.lineHeight,
    letterSpacing: step.letterSpacing === undefined ? undefined : step.letterSpacing * step.fontSize,
    fontWeight: String(headingWeight(a.weight, step.normalWeight)) as TextStyle['fontWeight'],
    color: a.gradient ? headingGradientStops(theme, a.color)[0] : inkFor(theme, a.color),
  };
}

export const Heading = React.forwardRef<RNText, HeadingProps>(
  (
    {
      level = HEADING_DEFAULT_LEVEL,
      size,
      color = HEADING_DEFAULT_COLOR,
      weight = HEADING_DEFAULT_WEIGHT,
      gradient = false,
      children,
      style,
      onClick,
      onPress,
      ...others
    },
    ref,
  ) => {
    const rest = withoutTestIdProps(others);
    const theme = useUiTheme();
    // The rank is `level`'s; the drawn step is `size`'s, falling back to the
    // rank's — the same two derivations the web makes from the same two props.
    const rank = HEADING_RANK[stepOf(level)];
    const step = stepOf(size ?? level);
    const resolved = React.useMemo(
      () => headingStyle(theme, { size: step, color, weight, gradient }),
      [theme, step, color, weight, gradient],
    );
    const handlePress =
      onClick || onPress
        ? (event: GestureResponderEvent): void => {
            onClick?.(event);
            onPress?.(event);
          }
        : undefined;

    return (
      <RNText
        ref={ref}
        role="heading"
        aria-level={rank}
        style={[resolved, style]}
        testID={resolveTestId(others)}
        onPress={handlePress}
        {...rest}
      >
        {children}
      </RNText>
    );
  },
);

Heading.displayName = 'Heading';
