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
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { resolveButtonProps } from './Button.helpers';
import {
  BUTTON_FONT_WEIGHT,
  BUTTON_ICON_GAP_UNITS,
  BUTTON_LINE_HEIGHT,
  BUTTON_RADIUS_UNITS,
  BUTTON_SIZES,
  BUTTON_SPINNER_SIZE,
  BUTTON_WASH_ALPHA,
  GLASS_BACKGROUND_ALPHA,
  GLASS_BACKGROUND_ALPHA_PRESSED,
  GLASS_BORDER_ALPHA,
  GLOW_INNER_ALPHA,
  GLOW_RADIUS,
  ICON_ONLY_PADDING,
  PULSE_ALPHA,
  PULSE_DURATION_MS,
  PULSE_SPREAD,
  buttonPalette,
  gradientStops,
  quietInk,
} from './Button.metrics';
import type { ButtonProps, ButtonVariant } from './Button.types.native';
import { childTestId, resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { alpha } from '../../../tokens/color';
import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';
import type { UiPaletteColor, UiTheme } from '../../../tokens/theme';

/** MUI's `min-width` for a button that carries a label. */
const MIN_WIDTH = 64;

interface Paint {
  container: ViewStyle;
  pressed: ViewStyle;
  label: TextStyle;
}

/**
 * What the web's `VARIANT_STYLES` paint, as three React Native styles: at rest,
 * while pressed (the web's `:hover`, which touch has no equivalent of), and the
 * label. Same palette arithmetic, same alphas.
 *
 * `gradient` is the one honest gap: React Native core has no gradient fill, so
 * it paints the gradient's first stop. A host wanting the real thing adds a
 * gradient library; the parity ledger records this.
 */
function paintFor(
  theme: UiTheme,
  variant: ButtonVariant,
  color: ColorValue,
  palette: UiPaletteColor,
  active: boolean,
): Paint {
  const wash = alpha(palette.main, BUTTON_WASH_ALPHA);
  switch (variant) {
    case 'outline':
      return {
        container: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.main },
        pressed: { backgroundColor: wash, borderColor: palette.dark },
        label: { color: palette.main },
      };
    case 'ghost':
      return {
        container: { backgroundColor: 'transparent' },
        pressed: { backgroundColor: wash },
        label: { color: quietInk(theme, palette) },
      };
    case 'text':
      return {
        container: { backgroundColor: active ? wash : 'transparent' },
        pressed: { backgroundColor: wash },
        label: { color: quietInk(theme, palette) },
      };
    case 'glass':
      return {
        container: {
          backgroundColor: alpha(theme.palette.background.paper, GLASS_BACKGROUND_ALPHA),
          borderWidth: 1,
          borderColor: alpha(theme.palette.divider, GLASS_BORDER_ALPHA),
        },
        pressed: { backgroundColor: alpha(theme.palette.background.paper, GLASS_BACKGROUND_ALPHA_PRESSED) },
        label: { color: palette.main },
      };
    case 'gradient': {
      const [from, to] = gradientStops(theme, color, palette);
      return {
        container: { backgroundColor: from },
        pressed: { backgroundColor: to },
        label: { color: '#fff' },
      };
    }
    default:
      return {
        container: { backgroundColor: palette.main },
        pressed: { backgroundColor: palette.dark },
        label: { color: palette.contrastText || '#fff' },
      };
  }
}

/** MUI's disabled treatment per variant family, so a disabled button reads as one on both sides. */
function disabledPaint(theme: UiTheme, variant: ButtonVariant): Paint {
  const filled = variant === 'solid' || variant === 'gradient' || variant === 'glass';
  return {
    container: filled
      ? { backgroundColor: theme.palette.action.disabledBackground, borderWidth: 0 }
      : variant === 'outline'
        ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.palette.action.disabledBackground }
        : { backgroundColor: 'transparent' },
    pressed: {},
    label: { color: theme.palette.action.disabled },
  };
}

function sizeStyle(theme: UiTheme, size: SizeValue, iconOnly: boolean, hasIcon: boolean): ViewStyle {
  const metrics = BUTTON_SIZES[size];
  if (iconOnly) {
    return { padding: ICON_ONLY_PADDING[size], minWidth: 0 };
  }
  return {
    paddingVertical: metrics.paddingVertical,
    paddingHorizontal: metrics.paddingHorizontal,
    minWidth: MIN_WIDTH,
    gap: hasIcon ? theme.spacing(BUTTON_ICON_GAP_UNITS) : undefined,
  };
}

function glowStyle(palette: UiPaletteColor): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation: 8 },
    default: {
      shadowColor: palette.main,
      shadowOpacity: GLOW_INNER_ALPHA,
      shadowRadius: GLOW_RADIUS,
      shadowOffset: { width: 0, height: 0 },
    },
  });
}

/** The web's `::after` pulse ring: a looped scale-and-fade behind the button. */
function Pulse({ color, radius, testID }: { color: string; radius: number; testID: string }): React.JSX.Element {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: PULSE_DURATION_MS,
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
        StyleSheet.absoluteFill,
        {
          pointerEvents: 'none',
          borderRadius: radius,
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [PULSE_ALPHA, 0, 0] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1 + PULSE_SPREAD / 40, 1] }) },
          ],
        },
      ]}
    />
  );
}

/**
 * A string or number child is the label and gets the label style; anything
 * else is rendered as given. No test id of its own: the web puts none on the
 * label, and a shared story that counts `/perf-button-/` must count buttons.
 */
function renderChildren(children: React.ReactNode, label: TextStyle): React.ReactNode {
  return React.Children.map(children, (child) =>
    typeof child === 'string' || typeof child === 'number' ? (
      <RNText style={label} numberOfLines={1}>
        {child}
      </RNText>
    ) : (
      child
    ),
  );
}

type ResolvedProps = ReturnType<typeof resolveButtonProps<ButtonProps>>;

interface ButtonLook {
  inactive: boolean;
  palette: UiPaletteColor;
  radius: number;
  label: TextStyle;
  container: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
}

/**
 * Everything the button paints, decided once per render from the resolved
 * props and the theme. Kept out of the component so the component reads as
 * structure — what renders where — and this reads as arithmetic.
 */
function buttonLook(theme: UiTheme, props: ResolvedProps): ButtonLook {
  const { variant, color, size, loading, icon, children, glow, pulse, active, disabled, style } = props;
  const palette = buttonPalette(theme, color);
  const iconOnly = !loading && icon != null && children == null;
  const inactive = Boolean(disabled) || loading;
  const paint = inactive ? disabledPaint(theme, variant) : paintFor(theme, variant, color, palette, active);
  const radius = theme.spacing(BUTTON_RADIUS_UNITS);
  const metrics = BUTTON_SIZES[size];
  // The web button is `overflow: hidden` (its ripple needs it) unless the pulse
  // ring turns it visible; on native the glow's shadow needs it visible too,
  // because a view's own shadow is clipped by its own overflow there.
  const overflow: ViewStyle['overflow'] = pulse || glow ? 'visible' : 'hidden';
  const sized = sizeStyle(theme, size, iconOnly, icon != null && !loading);
  const glowing = glow && !inactive ? glowStyle(palette) : null;

  return {
    inactive,
    palette,
    radius,
    label: {
      fontFamily: theme.typography.fontFamily,
      fontSize: metrics.fontSize,
      lineHeight: metrics.fontSize * BUTTON_LINE_HEIGHT,
      fontWeight: String(BUTTON_FONT_WEIGHT) as TextStyle['fontWeight'],
      textAlign: 'center',
      ...paint.label,
    },
    container: (state) => [
      styles.base,
      { borderRadius: radius, overflow },
      sized,
      paint.container,
      state.pressed && !inactive ? paint.pressed : null,
      glowing,
      style,
    ],
  };
}

/** The spinner that replaces the label while loading; `role` comes from react-native's ActivityIndicator. */
function Spinner({ color, testID }: { color: string; testID: string }): React.JSX.Element {
  return (
    <ActivityIndicator
      size={Platform.OS === 'ios' ? 'small' : BUTTON_SPINNER_SIZE}
      color={color}
      testID={testID}
      accessibilityLabel="loading"
    />
  );
}

export const Button = React.forwardRef<View, ButtonProps>((rawProps, ref) => {
  const resolved = resolveButtonProps(rawProps);
  const { loading, icon, iconPosition, pulse, ripple, children, onClick, onPress, ...others } = resolved;
  const theme = useUiTheme();
  const look = buttonLook(theme, resolved);

  // The shared stories pass `'data-testid'` as a plain prop; honour it here and
  // keep all three spellings off the element (react-native-web would drop them).
  const testId = resolveTestId(others, 'button');
  const idFor = (suffix: string) => childTestId(others, suffix, 'button');
  const rest = withoutTestIdProps(others);
  // `buttonLook` consumed these; they are not Pressable props.
  const { variant: _v, color: _c, size: _s, glow: _g, active: _a, disabled: _d, style: _st, ...pressable } = rest;

  const handlePress = (event: GestureResponderEvent): void => {
    onClick?.(event);
    onPress?.(event);
  };

  const iconNode =
    !loading && icon ? (
      <View style={styles.icon} testID={idFor('icon')}>
        {icon}
      </View>
    ) : null;

  return (
    <Pressable
      ref={ref}
      role="button"
      aria-disabled={look.inactive}
      aria-busy={loading}
      disabled={look.inactive}
      onPress={handlePress}
      android_ripple={ripple && !look.inactive ? { color: alpha(look.palette.main, 0.2), borderless: false } : undefined}
      style={look.container}
      testID={testId}
      {...pressable}
    >
      {pulse && !look.inactive ? <Pulse color={look.palette.main} radius={look.radius} testID={idFor('pulse')} /> : null}
      {iconPosition === 'left' ? iconNode : null}
      {loading ? <Spinner color={look.label.color as string} testID={idFor('loading')} /> : renderChildren(children, look.label)}
      {iconPosition === 'right' ? iconNode : null}
    </Pressable>
  );
});

Button.displayName = 'Button';

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    position: 'relative',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
