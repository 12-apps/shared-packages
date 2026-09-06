import * as React from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';

import { INPUT_PULSE } from './Input/Input.metrics';

/**
 * THE BAR THAT PULSES BEHIND A FIELD.
 *
 * `Input.styles.ts` and `Select.tsx` declare the same `::after` — a 56px wash
 * of the primary hue at 0.3, growing a 10px box-shadow ring and fading out
 * every two seconds — so the native halves draw it from one component rather
 * than one each. The numbers stay in `Input.metrics.ts`, which `Select.metrics`
 * re-exports under its own name.
 *
 * React Native has no box-shadow spread, so the ring is a scale on the bar.
 */
export function FieldPulse({
  color,
  radius,
  testID,
}: {
  color: string;
  radius: number;
  testID: string;
}): React.JSX.Element {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: INPUT_PULSE.ms,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <Animated.View
      testID={testID}
      aria-hidden
      style={[
        styles.pulse,
        {
          borderRadius: radius,
          backgroundColor: color,
          opacity: progress.interpolate({
            inputRange: [0, 0.7, 1],
            outputRange: [INPUT_PULSE.opacity, 0, 0],
          }),
          transform: [
            { translateY: -INPUT_PULSE.height / 2 },
            {
              scale: progress.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [1, 1 + INPUT_PULSE.spread / INPUT_PULSE.height, 1],
              }),
            },
          ],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  pulse: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: INPUT_PULSE.height,
    pointerEvents: 'none',
  },
});
