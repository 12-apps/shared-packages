import * as React from 'react';
import { Animated, Easing, Platform } from 'react-native';

/**
 * A CSS KEYFRAME LOOP, AS REACT NATIVE RUNS ONE.
 *
 * `animation: pulse 2s ease-in-out 0.5s infinite` is one declaration on the
 * web and four decisions here: a driving value, a timing, a delay that runs
 * ONCE (which is why the loop is sequenced behind an `Animated.delay` rather
 * than given the timing's own `delay`, which would replay every lap), and a
 * teardown. Several ported components paint a breathing surface, and each one
 * writing that out again is how two of them end up on different cadences.
 *
 * The value runs 0 → 1 and repeats; the caller interpolates it into whatever
 * the keyframes actually change.
 */
const DEFAULT_NATIVE_DRIVER = Platform.OS !== 'web';

export interface LoopOptions {
  durationMs: number;
  /** The CSS animation's delay, run once before the first lap. */
  delayMs?: number;
  easing?: (value: number) => number;
  /**
   * Layout properties (`left`, `width`, `height`) cannot be driven natively;
   * `opacity` and `transform` can. Defaults to native everywhere but the web.
   */
  useNativeDriver?: boolean;
}

export function useLoopedProgress(enabled: boolean, options: LoopOptions): Animated.Value {
  const {
    durationMs,
    delayMs = 0,
    easing = Easing.linear,
    useNativeDriver = DEFAULT_NATIVE_DRIVER,
  } = options;
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!enabled) return undefined;
    const animation = Animated.sequence([
      Animated.delay(delayMs),
      Animated.loop(
        Animated.timing(progress, { toValue: 1, duration: durationMs, easing, useNativeDriver }),
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, [enabled, durationMs, delayMs, easing, useNativeDriver, progress]);

  return progress;
}
