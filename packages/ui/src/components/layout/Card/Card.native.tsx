import * as React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { resolveCardProps } from './Card.helpers';
import { cardLook } from './Card.look.native';
import { CARD_LOADING, CARD_PULSE } from './Card.metrics';
import type { CardProps } from './Card.types.native';
import { PulseRing } from '../../../platform/pulse-ring.native';
import { childTestId, resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { renderTextChildren } from '../../../platform/text-children';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { muiTypeStyle } from '../../../tokens/mui-type';

// The shared stories import all five names from `./Card`, which resolves here
// under Metro and in the native Storybook; the slots live in their own file to
// keep this one about the envelope, and are re-exported so that import works.
export { CardActions, CardContent, CardHeader, CardMedia } from './CardParts.native';

/** The spinner a loading card centres over itself; `role` comes from `ActivityIndicator`. */
function Spinner({ color, testID }: { color: string; testID: string }): React.JSX.Element {
  return (
    <View testID={testID} style={[styles.spinner, { zIndex: CARD_LOADING.spinnerZIndex }]}>
      <ActivityIndicator
        size={Platform.OS === 'ios' ? 'large' : CARD_LOADING.spinnerSize}
        color={color}
      />
    </View>
  );
}

export const Card = React.forwardRef<View, CardProps>((rawProps, ref) => {
  const resolved = resolveCardProps(rawProps);
  const { children, loading, pulse, onClick, onPress, onFocus, onBlur, ...others } = resolved;
  const theme = useUiTheme();
  const look = cardLook(theme, resolved);

  const testID = resolveTestId(others, 'card');
  const idFor = (suffix: string): string => childTestId(others, suffix, 'card');
  const rest = withoutTestIdProps(others);
  // `cardLook` consumed these, and the reserved ones paint nothing on either
  // renderer; none of them is a `View` prop.
  const {
    variant: _variant,
    interactive,
    glow: _glow,
    borderRadius: _borderRadius,
    style,
    expandable: _expandable,
    expanded: _expanded,
    onExpandToggle: _onExpandToggle,
    entranceAnimation: _entranceAnimation,
    animationDelay: _animationDelay,
    skeleton: _skeleton,
    hoverScale: _hoverScale,
    ...viewProps
  } = rest;

  // A loading card is inert: no handler fires and pointer events are off, so a
  // half-rendered card cannot be pressed through. Same rule as the web.
  const idle = !loading;
  const handlePress = (event: GestureResponderEvent): void => {
    onClick?.(event);
    onPress?.(event);
  };

  const body = (
    <>
      {pulse ? (
        <PulseRing
          color={theme.palette.primary.main}
          radius={look.radius}
          spread={CARD_PULSE.spread}
          durationMs={CARD_PULSE.durationMs}
          fadeAt={CARD_PULSE.fadeAt}
          opacity={CARD_PULSE.alpha}
          testID={idFor('pulse')}
        />
      ) : null}
      {loading ? <Spinner color={theme.palette.primary.main} testID={idFor('loading')} /> : null}
      {renderTextChildren(children, { ...muiTypeStyle(theme, 'body1'), color: look.ink })}
    </>
  );

  const shared = { testID, onFocus: idle ? onFocus : undefined, onBlur: idle ? onBlur : undefined };

  if (!interactive && !onClick && !onPress) {
    return (
      <View ref={ref} style={[look.container, style]} {...shared} {...viewProps}>
        {body}
      </View>
    );
  }

  const container = ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
    look.container,
    pressed && idle ? look.pressed : null,
    style,
  ];

  return (
    <Pressable ref={ref} style={container} onPress={idle ? handlePress : undefined} {...shared} {...viewProps}>
      {body}
    </Pressable>
  );
});

Card.displayName = 'Card';

const styles = StyleSheet.create({
  spinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});
