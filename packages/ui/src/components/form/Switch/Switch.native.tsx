import * as React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type GestureResponderEvent,
  type ViewStyle,
} from 'react-native';

import { resolveSwitchProps, withoutSwitchProps, type ResolvedSwitchProps } from './Switch.helpers';
import {
  descriptionTextStyle,
  helperTextStyle,
  labelTextStyle,
  switchPalette,
  thumbStyle,
  trackStyle,
  type SwitchPaint,
  type SwitchState,
} from './Switch.look.native';
import {
  LABEL_GAP_UNITS,
  SWITCH_ICON,
  SWITCH_ICON_SIZES,
  SWITCH_PULSE,
  SWITCH_SPINNER,
  SWITCH_TRANSITION,
  TRACK_LABEL,
  geometryOf,
  lookOf,
  showsTrackLabels,
  thumbTravel,
  type SwitchGeometry,
} from './Switch.metrics';
import type { SwitchProps } from './Switch.types.native';
import { webKeyDown } from '../../../platform/aria';
import { childTestId, resolveTestId } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { UiTheme } from '../../../tokens/theme';

const nativeDriver = Platform.OS !== 'web';

/** The web writes the `on` wording in white, whatever the hue behind it. */
const TRACK_LABEL_ON_INK = '#fff';

/** A 0→1 value that follows `on`, over MUI's 300ms curve unless animation is off. */
function useProgress(on: boolean, animated: boolean): Animated.Value {
  const progress = React.useRef(new Animated.Value(on ? 1 : 0)).current;
  React.useEffect(() => {
    const timing = Animated.timing(progress, {
      toValue: on ? 1 : 0,
      duration: animated ? SWITCH_TRANSITION.ms : 0,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: nativeDriver,
    });
    timing.start();
    return () => timing.stop();
  }, [on, animated, progress]);
  return progress;
}

/** The web's `pulseAnimation` on the thumb: it breathes to 0.7 and 0.95 and back. */
function usePulse(enabled: boolean): { opacity?: Animated.AnimatedInterpolation<number>; scale?: Animated.AnimatedInterpolation<number> } {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!enabled) return undefined;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SWITCH_PULSE.ms,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: nativeDriver,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, progress]);
  if (!enabled) return {};
  return {
    opacity: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, SWITCH_PULSE.minOpacity, 1] }),
    scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, SWITCH_PULSE.minScale, 1] }),
  };
}

/** The wording the `label` variant prints inside the track, both halves at once. */
function TrackLabels({
  theme,
  onText,
  offText,
  contrastText,
}: {
  theme: UiTheme;
  onText?: string;
  offText?: string;
  contrastText: string;
}): React.JSX.Element {
  const inset = theme.spacing(TRACK_LABEL.insetUnits);
  const base = {
    fontFamily: theme.typography.fontFamily,
    fontSize: TRACK_LABEL.fontSize,
    fontWeight: String(TRACK_LABEL.fontWeight) as 'normal',
  };
  return (
    <View style={styles.trackLabels}>
      <RNText style={[base, { color: contrastText, marginLeft: inset }]}>{onText ?? ''}</RNText>
      <RNText style={[base, { color: theme.palette.text.secondary, marginRight: inset }]}>
        {offText ?? ''}
      </RNText>
    </View>
  );
}

/**
 * One of the two icons overlaid on the track.
 *
 * The web centres a hidden icon on the track and pins a shown one to `left: 4`
 * (or `right: 4`) with a `translate(∓50%)` — which puts half of it outside the
 * track. Same arithmetic here, in px.
 */
function SwitchIcon({
  icon,
  shown,
  animated,
  size,
  side,
  width,
}: {
  icon: React.ReactNode;
  shown: boolean;
  animated: boolean;
  size: number;
  side: 'on' | 'off';
  width: number;
}): React.JSX.Element {
  const half = size / 2;
  const offset = shown ? SWITCH_ICON.inset - half : width / 2 - half;
  return (
    <View
      style={[
        styles.icon,
        side === 'on' ? { left: offset } : { right: offset },
        {
          width: size,
          height: size,
          opacity: shown ? 1 : 0,
          transform: [{ translateY: -half }, { scale: shown && animated ? 1 : SWITCH_ICON.hiddenScale }],
        },
      ]}
    >
      {icon}
    </View>
  );
}

interface ControlProps {
  props: ResolvedSwitchProps;
  theme: UiTheme;
  checked: boolean;
  inactive: boolean;
  onToggle: (event?: GestureResponderEvent) => void;
  rest: Record<string, unknown>;
  testID: string;
}

/** The track, the thumb, and everything overlaid on them. */
function SwitchControl({ props, theme, checked, inactive, onToggle, rest, testID }: ControlProps): React.JSX.Element {
  const { variant, color, size, animated, loading, onIcon, offIcon, onText, offText } = props;
  const geometry: SwitchGeometry = geometryOf(size, props.trackWidth, props.trackHeight);
  const look = lookOf(variant);
  const palette = switchPalette(theme, color);
  const state: SwitchState = { checked, disabled: inactive };
  const paint: SwitchPaint = props;
  const { rest: restX, travel } = thumbTravel(look, geometry);
  const progress = useProgress(checked, animated);
  const pulse = usePulse(props.pulse && !loading);
  const iconSize = SWITCH_ICON_SIZES[size];

  return (
    <Pressable
      testID={testID}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={inactive}
      disabled={inactive}
      onPress={onToggle}
      {...webKeyDown((event) => {
        if (event.key === ' ' || event.key === 'Spacebar') onToggle();
      })}
      style={{ width: geometry.width, height: geometry.height }}
      {...rest}
    >
      <View style={trackStyle(theme, paint, palette, geometry, look, state)} />
      {showsTrackLabels(variant, onText, offText) ? (
        <TrackLabels theme={theme} onText={onText} offText={offText} contrastText={TRACK_LABEL_ON_INK} />
      ) : null}
      {onIcon == null ? null : (
        <SwitchIcon icon={onIcon} shown={checked} animated={animated} size={iconSize} side="on" width={geometry.width} />
      )}
      {offIcon == null ? null : (
        <SwitchIcon icon={offIcon} shown={!checked} animated={animated} size={iconSize} side="off" width={geometry.width} />
      )}
      <Animated.View
        style={[
          thumbStyle(theme, paint, geometry, look, state),
          { top: geometry.padding, left: restX, opacity: pulse.opacity },
          {
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) },
              ...(pulse.scale === undefined ? [] : [{ scale: pulse.scale }]),
            ],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator
            size={geometry.thumbSize * SWITCH_SPINNER.sizeRatio}
            color={palette.main}
            accessibilityLabel="loading"
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

/** The label and its description, in the column beside (or above) the control. */
function LabelBlock({
  theme,
  label,
  description,
  error,
  testID,
}: {
  theme: UiTheme;
  label: string;
  description?: string;
  error: boolean;
  testID: string;
}): React.JSX.Element {
  return (
    <View style={styles.labelBlock}>
      <RNText testID={testID} style={labelTextStyle(theme, error)}>
        {label}
      </RNText>
      {description === undefined ? null : (
        <RNText style={descriptionTextStyle(theme, error)}>{description}</RNText>
      )}
    </View>
  );
}

/** The row (or column) the label and the control share, per `labelPosition`. */
function labelRowStyle(theme: UiTheme, position: string): ViewStyle {
  const stacked = position === 'top' || position === 'bottom';
  return {
    flexDirection: position === 'top' ? 'column' : position === 'bottom' ? 'column-reverse' : 'row',
    alignItems: stacked ? 'flex-start' : 'center',
    gap: theme.spacing(stacked ? LABEL_GAP_UNITS.stacked : LABEL_GAP_UNITS.beside),
    width: '100%',
  };
}

/**
 * The native `Switch`.
 *
 * React Native's own `Switch` is the platform control at the platform's size,
 * with no track geometry, no thumb radius and no room for an icon — so this
 * draws the track and the thumb itself, off the same table the web styles MUI
 * with, and takes `role="checkbox"` with `aria-checked` for the state a hidden
 * `<input type="checkbox">` carries on the web. See `NATIVE-NOTES.md`.
 */
export const Switch = React.forwardRef<View, SwitchProps>((rawProps, ref) => {
  const props = resolveSwitchProps(rawProps);
  const {
    label, description, labelPosition, error, helperText, loading, disabled,
    checked, defaultChecked, onChange, onClick, onPress, style, ...others
  } = props;

  const theme = useUiTheme();
  const [own, setOwn] = React.useState(defaultChecked ?? false);
  const current = checked ?? own;
  const inactive = loading || disabled;
  const rest = withoutSwitchProps(others);

  // A keyboard toggle has no gesture behind it, so `onClick`/`onPress` — which
  // are press handlers — only fire when there is a press to report.
  const toggle = (event?: GestureResponderEvent): void => {
    const next = !current;
    setOwn(next);
    onChange?.({ target: { checked: next } }, next);
    if (event === undefined) return;
    onClick?.(event);
    onPress?.(event);
  };

  const control = (
    <SwitchControl
      props={props}
      theme={theme}
      checked={current}
      inactive={inactive}
      onToggle={toggle}
      rest={rest}
      testID={resolveTestId(others, 'switch') ?? 'switch'}
    />
  );

  return (
    <View ref={ref} testID={childTestId(others, 'container', 'switch')} style={style}>
      {label === undefined ? (
        control
      ) : (
        <View style={labelRowStyle(theme, labelPosition)}>
          {labelPosition === 'start' ? control : null}
          <LabelBlock
            theme={theme}
            label={label}
            description={description}
            error={error}
            testID={childTestId(others, 'label', 'switch')}
          />
          {labelPosition === 'start' ? null : control}
        </View>
      )}
      {helperText === undefined ? null : (
        <RNText testID={childTestId(others, 'helper', 'switch')} style={helperTextStyle(theme, error)}>
          {helperText}
        </RNText>
      )}
    </View>
  );
});

Switch.displayName = 'Switch';

const styles = StyleSheet.create({
  labelBlock: {
    flex: 1,
  },
  trackLabels: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    pointerEvents: 'none',
  },
  icon: {
    position: 'absolute',
    top: '50%',
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});
