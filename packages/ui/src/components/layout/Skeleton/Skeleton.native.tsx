import * as React from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { resolveSkeletonProps, skeletonInstanceTestId } from './Skeleton.helpers';
import {
  COMMON_BLACK,
  COMMON_WHITE,
  GLASS_BACKGROUND_ALPHA_FROM,
  GLASS_BORDER_ALPHA,
  GLASS_SHADOW,
  PULSE,
  SHIMMER_ALPHA,
  SHIMMER_DURATION_MS,
  SKELETON_DEFAULT_DIMENSIONS,
  SKELETON_INTENSITY_OPACITY,
  TEXT_LINE_HEIGHT_EM,
  TEXT_SCALE_Y,
  WAVE,
} from './Skeleton.metrics';
import type {
  SkeletonAnimation,
  SkeletonIntensity,
  SkeletonProps,
  SkeletonVariant,
} from './Skeleton.types.native';
import { useLoopedProgress } from '../../../platform/animation';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { alpha } from '../../../tokens/color';
import type { UiTheme } from '../../../tokens/theme';

/** MUI's `pulseKeyframe` runs `ease-in-out`. */
const PULSE_EASING = Easing.inOut(Easing.ease);
const PERCENT = /^-?\d+(?:\.\d+)?%$/;

/**
 * A width or a height, as React Native accepts one. The web takes any CSS
 * length; here a number is dp and a percentage is a percentage — anything else
 * (`10rem`, `calc(...)`) has no equivalent and sizes the box from its content,
 * which `NATIVE-NOTES.md` records.
 */
export function dimension(value: number | string | undefined): DimensionValue | undefined {
  if (value === undefined || typeof value === 'number') return value;
  return PERCENT.test(value) ? (value as `${number}%`) : undefined;
}

/** The tint the web writes: the body ink at the intensity's alpha, white in dark mode. */
export const skeletonTint = (theme: UiTheme, intensity: SkeletonIntensity): string =>
  alpha(
    theme.mode === 'dark' ? COMMON_WHITE : theme.palette.text.primary,
    SKELETON_INTENSITY_OPACITY[intensity],
  );

/** MUI's radius per variant: a circle, a square rectangle, the theme's 4px on text. */
const radiusFor = (theme: UiTheme, variant: SkeletonVariant): number => {
  if (variant === 'circular') return theme.radius.full;
  return variant === 'text' ? theme.radius.md : 0;
};

/**
 * The `text` variant's height. MUI gives it a `1.2em` line box and squashes the
 * whole box to 60%; React Native's transforms do not change layout, so the two
 * are multiplied out into the height the web actually shows.
 */
export function textBoxHeight(
  theme: UiTheme,
  height: number | string | undefined,
): DimensionValue | undefined {
  if (typeof height === 'string') return dimension(height);
  const box = height ?? theme.typography.sizes.md.fontSize * TEXT_LINE_HEIGHT_EM;
  return box * TEXT_SCALE_Y;
}

/**
 * `glassmorphism`: the gradient's first stop flat, the hairline, and the web's
 * own box-shadow string — React Native 0.76+ takes CSS shadow syntax, so the
 * two renderers draw the shadow from the same declaration. What is missing is
 * the 20px backdrop blur, which React Native has no equivalent of.
 */
function glassStyle(theme: UiTheme): ViewStyle {
  return {
    backgroundColor: alpha(theme.palette.background.paper, GLASS_BACKGROUND_ALPHA_FROM),
    borderWidth: 1,
    borderColor: alpha(theme.palette.divider, GLASS_BORDER_ALPHA),
    boxShadow: `0 ${GLASS_SHADOW.offsetY}px ${GLASS_SHADOW.blur}px 0 ${alpha(COMMON_BLACK, GLASS_SHADOW.alpha)}`,
  };
}

interface SkeletonBoxStyleArgs {
  variant: SkeletonVariant;
  intensity: SkeletonIntensity;
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  glassmorphism: boolean;
  /** A box with a wash sliding over it clips, as MUI's `wave` and the shimmer do. */
  clipped: boolean;
}

/** The box the web paints, in absolute numbers. */
export function skeletonBoxStyle(theme: UiTheme, a: SkeletonBoxStyleArgs): ViewStyle {
  const box = SKELETON_DEFAULT_DIMENSIONS[a.variant];
  const height = a.height ?? box.height;
  const style: ViewStyle = {
    width: dimension(a.width ?? box.width),
    height: a.variant === 'text' ? textBoxHeight(theme, height) : dimension(height),
    borderRadius: a.borderRadius ?? radiusFor(theme, a.variant),
    backgroundColor: skeletonTint(theme, a.intensity),
  };
  if (a.clipped) style.overflow = 'hidden';
  return a.glassmorphism ? { ...style, ...glassStyle(theme) } : style;
}

interface WashProps {
  color: string;
  durationMs: number;
  delayMs: number;
  testID?: string;
}

/**
 * MUI's sweeping `::after`, standing still. React Native core has no gradient
 * fill and no pseudo-elements, so the same wash covers the box and fades in and
 * out on the same cadence instead of travelling across it. It carries no
 * `aria-hidden` of its own: the box it sits in is already hidden, and the
 * shared stories count the boxes by that attribute.
 */
function Wash({ color, durationMs, delayMs, testID }: WashProps): React.JSX.Element {
  const progress = useLoopedProgress(true, { durationMs, delayMs, easing: Easing.linear });
  return (
    <Animated.View
      testID={testID}
      style={[
        StyleSheet.absoluteFill,
        {
          pointerEvents: 'none',
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] }),
        },
      ]}
    />
  );
}

interface SkeletonBoxProps extends SkeletonBoxStyleArgs {
  animation: SkeletonAnimation;
  shimmer: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  rest: ViewProps;
}

/** The web's `muiAnimationFor`: the `wave` VARIANT always animates as a wave. */
const effectiveAnimation = (
  variant: SkeletonVariant,
  animation: SkeletonAnimation,
): SkeletonAnimation => (variant === 'wave' ? 'wave' : animation);

/** One skeleton box: the tint, the pulse, and the wash the sweep stands in for. */
function SkeletonBox({
  animation,
  shimmer,
  style,
  testID,
  rest,
  ...styleArgs
}: SkeletonBoxProps): React.JSX.Element {
  const theme = useUiTheme();
  const animates = effectiveAnimation(styleArgs.variant, animation);
  const pulse = useLoopedProgress(animates === 'pulse', {
    durationMs: PULSE.durationMs,
    delayMs: PULSE.delayMs,
    easing: PULSE_EASING,
  });
  const box = skeletonBoxStyle(theme, styleArgs);
  const washId = testID ? `${testID}-wash` : undefined;

  return (
    <Animated.View
      aria-hidden
      testID={testID}
      style={[
        box,
        animates === 'pulse'
          ? { opacity: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, PULSE.dip, 1] }) }
          : null,
        style,
      ]}
      {...rest}
    >
      {shimmer ? (
        <Wash
          color={alpha(COMMON_WHITE, SHIMMER_ALPHA)}
          durationMs={SHIMMER_DURATION_MS}
          delayMs={0}
          testID={washId}
        />
      ) : null}
      {!shimmer && animates === 'wave' ? (
        <Wash
          color={theme.palette.action.hover}
          durationMs={WAVE.durationMs}
          delayMs={WAVE.delayMs}
          testID={washId}
        />
      ) : null}
    </Animated.View>
  );
}

/**
 * The native `Skeleton`: the same box, the same tint and the same default
 * dimensions the MUI half draws, on a `View`.
 */
export const Skeleton: React.FC<SkeletonProps> = React.memo(function Skeleton(rawProps) {
  const resolved = resolveSkeletonProps(rawProps);
  const {
    variant,
    animation,
    width,
    height,
    count,
    spacing,
    borderRadius,
    intensity,
    glassmorphism,
    shimmer,
    style,
    ...others
  } = resolved;
  const theme = useUiTheme();
  const testID = resolveTestId(others);
  const box: Omit<SkeletonBoxProps, 'testID'> = {
    variant,
    animation,
    intensity,
    width,
    height,
    borderRadius,
    glassmorphism,
    shimmer,
    clipped: shimmer || effectiveAnimation(variant, animation) === 'wave',
    style,
    rest: withoutTestIdProps(others),
  };

  // Handle edge case: count of 0 should render nothing
  if (count === 0) return null;
  if (count === 1) return <SkeletonBox {...box} testID={testID} />;

  return (
    <View style={{ gap: theme.spacing(spacing) }}>
      {Array.from({ length: count }, (_, index) => (
        <View key={`skeleton-${index}`}>
          <SkeletonBox {...box} testID={skeletonInstanceTestId(testID, index)} />
        </View>
      ))}
    </View>
  );
});

Skeleton.displayName = 'Skeleton';
