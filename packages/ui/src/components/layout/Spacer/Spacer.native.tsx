import * as React from 'react';
import { View, type ViewStyle } from 'react-native';

import { SPACER_FLEX_GROW, SPACER_FLEX_SHRINK, spacerDimensions } from './Spacer.metrics';
import type { SpacerDimension, SpacerProps } from './Spacer.types.native';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { cssLengthToPx } from '../../../tokens/css-units';
import type { BoxDimension } from '../Box/Box.base';

const PERCENTAGE = /^-?\d+(\.\d+)?%$/;
/** The lengths a 16px root can resolve. `vw`, `vh`, `ch`, `pt` and `calc()` cannot. */
const RESOLVABLE_LENGTH = /^-?\d+(\.\d+)?(px|rem|em)$/;

/**
 * A caller's dimension as React Native can take it. Numbers, percentages and
 * `auto` pass through; a CSS length (`2rem`, `1.5em`, `20px`) is read against
 * the 16px root the web would use, so the same string measures the same on
 * both sides. Anything else (`calc()`, `vw`) is not a length React Native has,
 * and yields to the size step — the same fallback an unset dimension takes.
 */
export function toNativeDimension(value: SpacerDimension | undefined): BoxDimension | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  if (value === 'auto') return 'auto';
  if (PERCENTAGE.test(value)) return value as `${number}%`;
  // Matched before conversion, because `cssLengthToPx` reads any string
  // `parseFloat` can start — `50vw` would silently become 50 px.
  if (!RESOLVABLE_LENGTH.test(value)) return undefined;
  const px = cssLengthToPx(value, Number.NaN);
  return Number.isNaN(px) ? undefined : px;
}

/**
 * The native `Spacer`: an empty `View` sized from the same metrics the web
 * puts in `sx`. Hidden from assistive technology and deaf to touches, as the
 * web one is to the pointer.
 */
export const Spacer = React.forwardRef<View, SpacerProps>(
  ({ size, direction, width, height, flex = false, style, ...others }, ref) => {
    const theme = useUiTheme();
    const dimensions = spacerDimensions(
      { size, direction, width: toNativeDimension(width), height: toNativeDimension(height) },
      theme.spacing,
    );
    // `userSelect` is the one web declaration with no View equivalent: a
    // React Native view holds no text to select.
    const resolved: ViewStyle = {
      width: dimensions.width,
      height: dimensions.height,
      flex: flex ? SPACER_FLEX_GROW : undefined,
      flexShrink: SPACER_FLEX_SHRINK,
      pointerEvents: 'none',
    };

    return (
      <View
        ref={ref}
        aria-hidden
        style={[resolved, style]}
        testID={resolveTestId(others)}
        {...withoutTestIdProps(others)}
      />
    );
  },
);

Spacer.displayName = 'Spacer';
