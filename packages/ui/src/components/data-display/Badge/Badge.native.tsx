import * as React from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import {
  badgeContentOf,
  formatCount,
  makeBadgeTestId,
  resolveBadgeProps,
  type ResolvedBadgeProps,
} from './Badge.helpers';
import { badgeAnchorStyle, badgeBoxStyle } from './Badge.look.native';
import {
  BOUNCE,
  CLOSE_DELAY_MS,
  FADE_IN_SCALE,
  PULSE,
} from './Badge.metrics';
import { BadgeContent } from './BadgeContent.native';
import type { BadgeProps } from './Badge.types.native';
import { webAria } from '../../../platform/aria';
import { resolveTestId } from '../../../platform/test-id';
import { useLoopedProgress } from '../../../platform/animation';
import { useUiTheme } from '../../../provider/use-ui-theme.native';

const nativeDriver = Platform.OS !== 'web';
type AnimatedStyle = Animated.WithAnimatedValue<ViewStyle>;

/** MUI's `pulseAnimation`: 1 → 1.2 → 1 while the opacity dips, every two seconds. */
function usePulseStyle(enabled: boolean): AnimatedStyle | null {
  const progress = useLoopedProgress(enabled, {
    durationMs: PULSE.durationMs,
    easing: Easing.inOut(Easing.ease),
  });
  if (!enabled) return null;
  return {
    opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, PULSE.opacity, 1] }),
    transform: [
      { scale: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, PULSE.scale, 1] }) },
    ],
  };
}

/** A 0→1 progress that runs once on mount, for the entrance keyframes. */
function useEntrance(enabled: boolean, durationMs: number): Animated.Value {
  const progress = React.useRef(new Animated.Value(enabled ? 0 : 1)).current;
  React.useEffect(() => {
    if (!enabled) return undefined;
    progress.setValue(0);
    const timing = Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: nativeDriver,
    });
    timing.start();
    return () => timing.stop();
  }, [enabled, durationMs, progress]);
  return progress;
}

/** `bounceAnimation` when asked for, else `fadeInScaleAnimation`; neither when neither. */
function useEntranceStyle(animate: boolean, bounce: boolean): AnimatedStyle | null {
  const progress = useEntrance(animate || bounce, bounce ? BOUNCE.durationMs : FADE_IN_SCALE.durationMs);
  if (bounce) {
    return {
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1],
            outputRange: [0, 0, -BOUNCE.lift, 0, -BOUNCE.secondLift, 0, 0],
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1],
            outputRange: [1, 1, BOUNCE.scale, 1, BOUNCE.secondScale, 1, 1],
          }),
        },
      ],
    };
  }
  if (!animate) return null;
  return {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [FADE_IN_SCALE.from, FADE_IN_SCALE.overshoot, 1],
        }),
      },
    ],
  };
}

/** MUI's `Zoom` on close: out over 300ms, then the caller is told. */
function useCloseZoom(onClose?: () => void): { style: AnimatedStyle; close: () => void } {
  const progress = React.useRef(new Animated.Value(1)).current;
  const close = React.useCallback(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_DELAY_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: nativeDriver,
    }).start(({ finished }) => {
      if (finished) onClose?.();
    });
  }, [onClose, progress]);
  return { style: { opacity: progress, transform: [{ scale: progress }] }, close };
}

interface ChipContent {
  content: React.ReactNode;
  /** A count that formatted away leaves nothing worth showing. */
  hidden: boolean;
}

/** What the chip shows, and whether there is anything to show at all. */
function chipContent(resolved: ResolvedBadgeProps<BadgeProps>): ChipContent {
  const { variant, max, showZero, invisible, icon, closable } = resolved;
  const raw = badgeContentOf(resolved);
  const content = variant === 'count' ? formatCount(raw, { max, showZero }) : raw;
  // The web hides the chip only when the whole run assembles to nothing
  // (`buildBadgeContent` returns null on an empty `parts`), so a zero count
  // still draws while an icon or a close button is left to draw with it.
  const hasOtherParts = Boolean(icon) || Boolean(closable);
  return {
    content,
    hidden:
      Boolean(invisible) ||
      (variant === 'count' && content === null && !showZero && !hasOtherParts),
  };
}

/**
 * The native `Badge`: MUI's chip anchored off a corner of whatever it is
 * attached to, with the same ten variants, five sizes and content run.
 */
export const Badge = React.forwardRef<View, BadgeProps>((rawProps, ref) => {
  const resolved = resolveBadgeProps(rawProps);
  const {
    variant,
    size,
    color,
    glow,
    pulse,
    animate,
    bounce,
    max: _max,
    showZero: _showZero,
    position,
    invisible,
    closable,
    onClose,
    icon,
    children,
    style,
    'aria-label': ariaLabel,
    'aria-live': ariaLive = 'polite',
    'aria-atomic': ariaAtomic = true,
    'data-testid': _domTestId,
    testID: _testID,
    dataTestId: _dataTestId,
    content: _content,
    badgeContent: _badgeContent,
    shimmer: _shimmer,
    ...rest
  } = resolved;
  const theme = useUiTheme();
  const badgeId = resolveTestId(resolved);
  const idFor = makeBadgeTestId(badgeId);
  const pulseStyle = usePulseStyle(pulse && !invisible);
  const entrance = useEntranceStyle(animate && !bounce, bounce);
  const zoom = useCloseZoom(onClose);

  const { content, hidden } = chipContent(resolved);

  return (
    <View ref={ref} testID={badgeId || 'badge'} style={[styles.anchor, style]} {...rest}>
      {children}
      {hidden ? null : (
        <View style={badgeAnchorStyle(position)}>
          <Animated.View
            testID={idFor('content-wrapper')}
            aria-label={ariaLabel}
            aria-live={ariaLive}
            {...webAria({ 'aria-atomic': ariaAtomic ? 'true' : 'false' })}
            style={[badgeBoxStyle(theme, { variant, size, color, glow }), entrance, pulseStyle, zoom.style]}
          >
            <BadgeContent
              variant={variant}
              size={size}
              color={color}
              icon={icon}
              closable={closable}
              content={content}
              idFor={idFor}
              onClose={zoom.close}
            />
          </Animated.View>
        </View>
      )}
    </View>
  );
});

Badge.displayName = 'Badge';

const styles = StyleSheet.create({
  /** MUI's badge root: `inline-flex`, with the chip positioned against it. */
  anchor: { position: 'relative', alignSelf: 'flex-start', flexDirection: 'row' },
});
