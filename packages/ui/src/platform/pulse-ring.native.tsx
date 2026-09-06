import * as React from 'react';
import { Animated, Easing } from 'react-native';

/**
 * THE `::after` PULSE, AS A REACT NATIVE VIEW.
 *
 * `Card` and `Dialog` pulse the same way on the web: an `::after` that fills
 * the element, carries `box-shadow: 0 0 0 <spread>px currentColor` and animates
 * that spread out and back while fading, once every two seconds, from BEHIND
 * the element (`z-index: -1`). Those two read this; `Button.native.tsx` still
 * carries its own `Pulse`, a filled overlay that scales and fades rather than a
 * ring, and folding it onto this is a `form/Button` change.
 *
 * React Native cannot paint a child behind its parent's own background, so a
 * filled overlay would wash the surface instead of haloing it. This draws a
 * HOLLOW ring instead: the view is inset by the current spread and carries a
 * border of exactly that width, so the band it paints is precisely the region
 * from the surface's edge to `spread` outside it — the same band the box-shadow
 * spread covers, and nothing over the surface itself.
 *
 * Layout props cannot run on the native driver, so this animates on the JS one.
 */
export interface PulseRingProps {
  color: string;
  /** The surface's own corner radius, which the ring follows. */
  radius: number | string;
  /** How far out of the edge the ring grows, in px. */
  spread: number;
  durationMs: number;
  /** The fraction of the cycle the ring is still visible for. */
  fadeAt: number;
  /** The ring's opacity at the start of a cycle. */
  opacity: number;
  testID: string;
}

export function PulseRing({
  color,
  radius,
  spread,
  durationMs,
  fadeAt,
  opacity,
  testID,
}: PulseRingProps): React.JSX.Element {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: durationMs,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [durationMs, progress]);

  const grow = progress.interpolate({ inputRange: [0, fadeAt, 1], outputRange: [0, spread, 0] });
  const inset = Animated.multiply(grow, -1);

  return (
    <Animated.View
      testID={testID}
      aria-hidden
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        top: inset,
        left: inset,
        right: inset,
        bottom: inset,
        borderWidth: grow,
        borderColor: color,
        borderRadius: radius,
        opacity: progress.interpolate({ inputRange: [0, fadeAt, 1], outputRange: [opacity, 0, 0] }),
      }}
    />
  );
}
