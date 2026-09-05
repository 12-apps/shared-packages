import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { iconFill } from './icon-color';
import { iconSize, type IconBaseProps } from './Icon.types';
import { ICON_PATHS } from './paths.generated';
import { resolveTestId } from '../platform/test-id';
import { useUiTheme } from '../provider/use-ui-theme.native';

export interface IconProps extends IconBaseProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * The native `Icon`: `react-native-svg` drawing the same generated path the web
 * `SvgIcon` draws, in the same 24-unit box, at the same px size.
 */
export function Icon({ name, size, color, label, style, ...rest }: IconProps): React.JSX.Element {
  const theme = useUiTheme();
  const px = iconSize(size);
  const fill = iconFill(theme, color, theme.palette.text.primary);
  const testId = resolveTestId(rest, `icon-${name}`);

  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill={fill}
      style={style}
      testID={testId}
      role="img"
      aria-label={label}
      aria-hidden={!label}
    >
      {ICON_PATHS[name].map((d) => (
        <Path key={d} d={d} fill={fill} />
      ))}
    </Svg>
  );
}

Icon.displayName = 'Icon';
