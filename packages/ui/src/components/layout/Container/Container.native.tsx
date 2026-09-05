import * as React from 'react';
import { View, useWindowDimensions, type ViewStyle } from 'react-native';

import {
  CONTAINER_COMPACT_BELOW,
  CONTAINER_MAX_WIDTHS,
  containerPaddingUnits,
  containerVerticalUnits,
  resolveContainerMaxWidth,
} from './Container.metrics';
import type { ContainerMaxWidth, ContainerPadding, ContainerProps, ContainerVariant } from './Container.types.native';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { UiTheme } from '../../../tokens/theme';

export interface ContainerStyleArgs {
  variant: ContainerVariant;
  maxWidth: ContainerMaxWidth | string;
  padding: ContainerPadding;
  responsive: boolean;
  /** The window, for the two things CSS answers with a media query and `100vh`. */
  window: { width: number; height: number };
}

/**
 * The style MUI's `Container` plus the web `sx` paint, in absolute numbers.
 *
 * `width: 100%` between auto margins is MUI's own centring rule; `maxWidth` is
 * the breakpoint the web applies under `min-width` (below it the column is
 * narrower anyway); the `responsive` media query becomes a window-width test;
 * `centered`'s `100vh` becomes the window height. `padded`'s vertical inset
 * and `padding="none"`'s zero come from the same two functions the web reads.
 */
export function containerStyle(theme: UiTheme, a: ContainerStyleArgs): ViewStyle {
  const compact = a.responsive && a.window.width < CONTAINER_COMPACT_BELOW;
  const limit = resolveContainerMaxWidth(a.variant, a.maxWidth);
  return {
    width: '100%',
    marginLeft: 'auto',
    marginRight: 'auto',
    maxWidth: limit === false ? undefined : CONTAINER_MAX_WIDTHS[limit],
    padding: theme.spacing(containerPaddingUnits(a.padding, compact)),
    paddingVertical: theme.spacing(containerVerticalUnits(a.variant, a.padding, compact)),
    ...(a.variant === 'centered'
      ? { alignItems: 'center', justifyContent: 'center', minHeight: a.window.height }
      : null),
  };
}

/** The native `Container`: a `View` sized by the same rules MUI's `Container` and the web `sx` apply. */
export const Container = React.forwardRef<View, ContainerProps>(
  ({ children, maxWidth = 'lg', variant = 'default', padding = 'md', responsive = true, style, ...others }, ref) => {
    const theme = useUiTheme();
    const window = useWindowDimensions();
    const resolved = React.useMemo(
      () => containerStyle(theme, { variant, maxWidth, padding, responsive, window }),
      [theme, variant, maxWidth, padding, responsive, window],
    );

    return (
      <View
        ref={ref}
        style={[resolved, style]}
        testID={resolveTestId(others, 'container')}
        {...withoutTestIdProps(others)}
      >
        {children}
      </View>
    );
  },
);

Container.displayName = 'Container';
