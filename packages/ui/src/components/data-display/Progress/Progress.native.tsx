import * as React from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { progressFraction, progressLabelText, resolveProgressProps } from './Progress.helpers';
import {
  barStyle,
  circularGlowStyle,
  labelStyle,
  segmentStyle,
  trackStyle,
} from './Progress.look.native';
import {
  CIRCULAR_INDETERMINATE,
  CIRCULAR_ROTATION_DEG,
  CIRCULAR_VIEWBOX,
  LABEL_MARGIN_TOP_UNITS,
  LINEAR_INDETERMINATE,
  PROGRESS_SIZES,
  PULSE,
  SEGMENT_GAP_UNITS,
  circularCircumference,
  circularDashOffset,
  progressPalette,
} from './Progress.metrics';
import type { ProgressProps, ProgressSize, ProgressVariant } from './Progress.types.native';
import { useLoopedProgress } from '../../../platform/animation';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { ColorValue } from '../../../tokens/vocabulary';

type ValueAria = Pick<ViewProps, 'aria-valuenow' | 'aria-valuemin' | 'aria-valuemax'>;

/** MUI names the value only when it knows it; an indeterminate bar reports none. */
const valueAria = (value: number | undefined): ValueAria =>
  value === undefined
    ? {}
    : { 'aria-valuenow': Math.round(value), 'aria-valuemin': 0, 'aria-valuemax': 100 };

/** MUI's `pulseAnimation`, as an opacity the caller can merge into a style. */
function usePulseStyle(enabled: boolean): { opacity: Animated.AnimatedInterpolation<number> } | null {
  const progress = useLoopedProgress(enabled, {
    durationMs: PULSE.durationMs,
    easing: PULSE_EASING,
  });
  if (!enabled) return null;
  return {
    opacity: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, PULSE.dip, 1] }),
  };
}

const PULSE_EASING = Easing.inOut(Easing.ease);

interface ViewArgs {
  size: ProgressSize;
  color: ColorValue;
  glow: boolean;
  pulse: boolean;
  showLabel: boolean;
  displayValue: number;
  displayLabel: string;
  /** Absent means indeterminate — the bar animates rather than reporting progress. */
  value?: number;
  /** The component's own id; the parts derive theirs from it. */
  testID: string;
  /** The id the addressed element takes — the caller's `data-testid` when they gave one. */
  elementTestID: string;
  style?: StyleProp<ViewStyle>;
  containerRef?: React.Ref<View>;
  rest: ViewProps;
}

function ProgressLabel({
  size,
  label,
  testID,
  muted = false,
  spaced = false,
}: {
  size: ProgressSize;
  label: string;
  testID: string;
  muted?: boolean;
  spaced?: boolean;
}): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <RNText
      testID={testID}
      style={[
        labelStyle(theme, size, muted),
        spaced ? { marginTop: theme.spacing(LABEL_MARGIN_TOP_UNITS) } : null,
      ]}
    >
      {label}
    </RNText>
  );
}

/**
 * MUI's `bar1Indeterminate`: a third of the track crossing it every 2.1s.
 * Two bars on the web, one here — `NATIVE-NOTES.md` records the difference.
 */
function useSweepStyle(enabled: boolean): Animated.WithAnimatedValue<ViewStyle> | null {
  const width = `${LINEAR_INDETERMINATE.width * 100}%` as const;
  const progress = useLoopedProgress(enabled, {
    durationMs: LINEAR_INDETERMINATE.durationMs,
    // `left` is a layout property, which the native driver cannot animate.
    useNativeDriver: false,
  });
  if (!enabled) return null;
  return {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width,
    left: progress.interpolate({ inputRange: [0, 1], outputRange: [`-${width}`, '100%'] }),
  };
}

function LinearView({
  variant,
  size,
  color,
  glow,
  pulse,
  showLabel,
  displayValue,
  displayLabel,
  value,
  testID,
  elementTestID,
  style,
  containerRef,
  rest,
}: ViewArgs & { variant: ProgressVariant }): React.JSX.Element {
  const theme = useUiTheme();
  const pulseStyle = usePulseStyle(pulse);
  const sweep = useSweepStyle(value === undefined);

  return (
    <View ref={containerRef} testID={testID} style={[styles.block, style]}>
      <View
        testID={elementTestID}
        role="progressbar"
        {...valueAria(value)}
        style={trackStyle(theme, size, color)}
        {...rest}
      >
        <Animated.View
          style={[
            barStyle(theme, { variant, size, color, glow }),
            sweep ?? { width: `${progressFraction(displayValue)}%` },
            pulseStyle,
          ]}
        />
      </View>
      {showLabel ? (
        <ProgressLabel size={size} label={displayLabel} testID={`${testID}-label`} spaced />
      ) : null}
    </View>
  );
}

/** MUI's `circular-rotate`: one turn every 1.4s behind an arc that never closes. */
function useSpinStyle(enabled: boolean): Animated.WithAnimatedValue<ViewStyle> {
  const progress = useLoopedProgress(enabled, {
    durationMs: CIRCULAR_INDETERMINATE.rotationMs,
  });
  if (!enabled) {
    return { transform: [{ rotate: `${CIRCULAR_ROTATION_DEG}deg` }] };
  }
  return {
    transform: [
      { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
    ],
  };
}

function CircularDial({
  diameter,
  thickness,
  stroke,
  dashOffset,
}: {
  diameter: number;
  thickness: number;
  stroke: string;
  dashOffset: number;
}): React.JSX.Element {
  const half = CIRCULAR_VIEWBOX / 2;
  return (
    <Svg
      width={diameter}
      height={diameter}
      viewBox={`${half} ${half} ${CIRCULAR_VIEWBOX} ${CIRCULAR_VIEWBOX}`}
    >
      <Circle
        cx={CIRCULAR_VIEWBOX}
        cy={CIRCULAR_VIEWBOX}
        r={(CIRCULAR_VIEWBOX - thickness) / 2}
        fill="none"
        stroke={stroke}
        strokeWidth={thickness}
        strokeDasharray={circularCircumference(thickness)}
        strokeDashoffset={dashOffset}
      />
    </Svg>
  );
}

function CircularView({
  size,
  color,
  glow,
  pulse,
  showLabel,
  displayValue,
  displayLabel,
  value,
  testID,
  elementTestID,
  style,
  containerRef,
  rest,
  thickness,
  circularSize,
}: ViewArgs & { thickness: number; circularSize?: number }): React.JSX.Element {
  const theme = useUiTheme();
  const indeterminate = value === undefined;
  const pulseStyle = usePulseStyle(pulse);
  const spin = useSpinStyle(indeterminate);
  const diameter = circularSize || PROGRESS_SIZES[size].circularSize;
  const box = { width: diameter, height: diameter };

  return (
    <View ref={containerRef} testID={testID} style={[styles.inline, style]}>
      <Animated.View
        testID={elementTestID}
        role="progressbar"
        {...valueAria(value)}
        style={[box, glow ? circularGlowStyle(theme, color) : null, pulseStyle]}
        {...rest}
      >
        <Animated.View style={[box, spin]}>
          <CircularDial
            diameter={diameter}
            thickness={thickness}
            stroke={progressPalette(theme, color).main}
            dashOffset={
              indeterminate
                ? circularCircumference(thickness) * (1 - CIRCULAR_INDETERMINATE.arc)
                : circularDashOffset(displayValue, thickness)
            }
          />
        </Animated.View>
      </Animated.View>
      {showLabel && !indeterminate ? (
        <View style={[StyleSheet.absoluteFill, styles.centre]}>
          <ProgressLabel size={size} label={displayLabel} testID={`${testID}-label`} muted />
        </View>
      ) : null}
    </View>
  );
}

function SegmentedView({
  size,
  color,
  glow,
  pulse,
  showLabel,
  displayValue,
  displayLabel,
  testID,
  elementTestID,
  style,
  containerRef,
  rest,
  segments,
}: ViewArgs & { segments: number }): React.JSX.Element {
  const theme = useUiTheme();
  const pulseStyle = usePulseStyle(pulse);
  const filled = Math.floor((progressFraction(displayValue) / 100) * segments);

  return (
    <View ref={containerRef} testID={elementTestID} style={[styles.block, style]} {...rest}>
      <View
        testID={`${testID}-segments-container`}
        style={[styles.segments, { gap: theme.spacing(SEGMENT_GAP_UNITS) }]}
      >
        {Array.from({ length: segments }, (_, index) => (
          <Animated.View
            key={`segment-${index}`}
            testID={`${testID}-segment-${index}`}
            style={[
              segmentStyle(theme, { size, color, filled: index < filled, glow }),
              index < filled ? pulseStyle : null,
            ]}
          />
        ))}
      </View>
      {showLabel ? (
        <ProgressLabel size={size} label={displayLabel} testID={`${testID}-label`} spaced />
      ) : null}
    </View>
  );
}

/**
 * The native `Progress`: the same track, bar, dial and segments the MUI half
 * draws, on `View`s and a `react-native-svg` arc.
 */
export const Progress = React.forwardRef<View, ProgressProps>((rawProps, ref) => {
  const {
    variant,
    size,
    color,
    glow,
    pulse,
    showLabel,
    label,
    segments,
    thickness,
    circularSize,
    value,
    dataTestId,
    testID,
    style,
    'data-testid': elementId,
    ...rest
  } = resolveProgressProps(rawProps);
  const displayValue = value || 0;
  // `testID` is React Native's spelling of `dataTestId` and names the component;
  // `data-testid` names the ELEMENT, which is where the web puts it.
  const base = testID ?? dataTestId;
  const shared: ViewArgs = {
    size,
    color,
    glow,
    pulse,
    showLabel,
    displayValue,
    displayLabel: progressLabelText(label, showLabel, displayValue),
    value,
    testID: base,
    elementTestID: base,
    style,
    containerRef: ref,
    rest,
  };

  if (variant === 'circular') {
    return (
      <CircularView
        {...shared}
        elementTestID={elementId ?? `${base}-circular`}
        thickness={thickness}
        circularSize={circularSize}
      />
    );
  }

  if (variant === 'segmented') {
    return <SegmentedView {...shared} elementTestID={elementId ?? base} segments={segments} />;
  }

  return <LinearView {...shared} elementTestID={elementId ?? `${base}-linear`} variant={variant} />;
});

Progress.displayName = 'Progress';

const styles = StyleSheet.create({
  block: { width: '100%' },
  /** MUI's `display: inline-flex` on the circular wrapper. */
  inline: { position: 'relative', alignSelf: 'flex-start' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', width: '100%' },
});
