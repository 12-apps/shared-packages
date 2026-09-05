import * as React from 'react';
import { View } from 'react-native';

import { resolveBoxLayout, splitBoxProps } from './box-layout';
import type { BoxProps } from './Box.types.native';
import { resolveTestId } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';

/** The native `Box`: a `View` with the same resolved numbers the web `Box` puts in `sx`. */
export const Box = React.forwardRef<View, BoxProps>(({ children, style, ...props }, ref) => {
  const theme = useUiTheme();
  const { layout, rest } = splitBoxProps(props);
  const resolved = resolveBoxLayout(layout, theme);

  return (
    <View ref={ref} style={[resolved, style]} testID={resolveTestId(layout)} {...rest}>
      {children}
    </View>
  );
});

Box.displayName = 'Box';
