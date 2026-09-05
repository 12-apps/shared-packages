import * as React from 'react';
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  type Role,
  StyleSheet,
  Text as RNText,
  View,
  type ViewStyle,
} from 'react-native';

import { defaultAriaLive, resolveAlertProps, testIdFor, VARIANT_ICON } from './Alert.helpers';
import {
  actionSlotStyle,
  alertLook,
  closeButtonStyle,
  descriptionStyle,
  iconSlotStyle,
  messageSlotStyle,
  messageTextStyle,
  titleStyle,
} from './Alert.look.native';
import { CLOSE_BUTTON, CLOSE_DELAY_MS, COLLAPSE_MS, FADE_IN, ICON_SLOT, ICON_SPIN, PULSE } from './Alert.metrics';
import type { AlertProps, AlertVariant } from './Alert.types.native';
import { Icon } from '../../../icons/Icon.native';
import { webAria } from '../../../platform/aria';
import { renderTextChildren } from '../../../platform/text-children';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';

type AnimatedStyle = Animated.WithAnimatedValue<ViewStyle>;
const nativeDriver = Platform.OS !== 'web';

/** A 0→1 progress that starts on mount when `animate` is set, else sits at 1. */
function useProgress(animate: boolean, duration: number): Animated.Value {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  React.useEffect(() => {
    if (!animate) return undefined;
    const timing = Animated.timing(progress, { toValue: 1, duration, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver });
    timing.start();
    return () => timing.stop();
  }, [animate, duration, progress]);
  return progress;
}

/** The web's `fadeInScale` keyframes: in from 0 opacity, 0.95 scale and 10px above, over 300ms. */
function useFadeIn(animate: boolean): AnimatedStyle | undefined {
  const progress = useProgress(animate, FADE_IN.ms);
  if (!animate) return undefined;
  return {
    opacity: progress,
    transform: [
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [FADE_IN.scale, 1] }) },
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-FADE_IN.lift, 0] }) },
    ],
  };
}

/** The web's `iconRotate` keyframes: one full turn, 0.8 → 1.1 → 1, over 600ms. */
function useIconSpin(animate: boolean): AnimatedStyle | undefined {
  const progress = useProgress(animate, ICON_SPIN.ms);
  if (!animate) return undefined;
  return {
    transform: [
      { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
      { scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [ICON_SPIN.from, ICON_SPIN.mid, 1] }) },
    ],
  };
}

/** The web's `::after` pulse: a wash of the hue over the card, fading out every two seconds, behind the words. */
function Pulse({ color, radius, testID }: { color: string; radius: number; testID: string }): React.JSX.Element {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: PULSE.ms, easing: Easing.linear, useNativeDriver: nativeDriver }),
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
          opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [PULSE.alpha, 0, 0] }),
        },
      ]}
    />
  );
}

/**
 * MUI's `Collapse`: open, it is a plain wrapper with its overflow visible (so
 * a glow can escape); closing, it clips and shrinks over 300ms, then says so.
 */
function Collapse({ open, onCollapsed, children }: { open: boolean; onCollapsed: () => void; children: React.ReactNode }): React.JSX.Element {
  const [height, setHeight] = React.useState<number | null>(null);
  const progress = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (open) return undefined;
    const timing = Animated.timing(progress, { toValue: 0, duration: COLLAPSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: false });
    timing.start(({ finished }) => {
      if (finished) onCollapsed();
    });
    return () => timing.stop();
  }, [open, onCollapsed, progress]);
  const onLayout = (event: LayoutChangeEvent): void => {
    if (open) setHeight(event.nativeEvent.layout.height);
  };
  const shrink: AnimatedStyle = height == null ? {} : { maxHeight: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) };
  return (
    <Animated.View style={[{ overflow: open ? 'visible' : 'hidden', opacity: progress }, shrink]}>
      <View onLayout={onLayout}>{children}</View>
    </Animated.View>
  );
}

interface IconSlotProps {
  variant: AlertVariant;
  icon: React.ReactNode;
  color: string;
  animate: boolean;
  testID: string;
}

/** The icon slot; `glass` and `gradient` have no glyph of their own, so theirs is empty unless an `icon` is given — as on the web. */
function IconSlot({ variant, icon, color, animate, testID }: IconSlotProps): React.JSX.Element {
  const theme = useUiTheme();
  const spin = useIconSpin(animate);
  const glyph = VARIANT_ICON[variant];
  return (
    <Animated.View testID={testID} style={[iconSlotStyle(theme), spin]}>
      {icon || (glyph ? <Icon name={glyph} size={ICON_SLOT.size} color={color} /> : null)}
    </Animated.View>
  );
}

function CloseButton({ label, ink, onPress, testID }: { label: string | undefined; ink: string; onPress: () => void; testID: string }): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <Pressable role="button" aria-label={label} testID={testID} onPress={onPress} style={({ pressed }) => closeButtonStyle(theme, pressed)}>
      <Icon name="Close" size={CLOSE_BUTTON.iconSize} color={ink} />
    </Pressable>
  );
}

interface ContentProps {
  title?: string;
  description?: string;
  children?: React.ReactNode;
  ink: string;
  testId: string;
}

function AlertContent({ title, description, children, ink, testId }: ContentProps): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <View style={messageSlotStyle(theme)}>
      {title ? (
        <RNText testID={testIdFor(testId, 'title')} style={titleStyle(theme, ink, Boolean(description))}>
          {title}
        </RNText>
      ) : null}
      {description ? (
        <RNText testID={testIdFor(testId, 'message')} style={descriptionStyle(theme, ink)}>
          {description}
        </RNText>
      ) : null}
      {renderTextChildren(children, messageTextStyle(theme, ink))}
    </View>
  );
}

/** The dismiss sequence the web runs: mark closing, fire `onClose` 200ms in, stay until the collapse has run. */
function useDismiss(onClose: (() => void) | undefined): { open: boolean; gone: boolean; close: () => void; onCollapsed: () => void } {
  const [closing, setClosing] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const close = (): void => {
    setClosing(true);
    timer.current = setTimeout(() => onClose?.(), CLOSE_DELAY_MS);
  };
  const onCollapsed = React.useCallback(() => setGone(true), []);
  return { open: !closing, gone, close, onCollapsed };
}

export const Alert = React.forwardRef<View, AlertProps>((alertProps, ref) => {
  const {
    variant, color, glow, pulse, icon, showIcon, onClose, title, description, children, animate, role,
    'aria-atomic': ariaAtomic, 'aria-live': _ariaLive, closable, closeLabel, style, ...others
  } = resolveAlertProps(alertProps);
  const theme = useUiTheme();
  const testId = resolveTestId(others, 'alert') as string;
  const rest = withoutTestIdProps(others);
  const look = alertLook(theme, { variant, color, glow, pulse });
  const fadeIn = useFadeIn(animate);
  const dismiss = useDismiss(onClose);

  if (dismiss.gone) return null;
  return (
    <Collapse open={dismiss.open} onCollapsed={dismiss.onCollapsed}>
      <Animated.View
        ref={ref}
        role={role as Role}
        aria-live={alertProps['aria-live'] ?? defaultAriaLive(variant)}
        {...webAria({ 'aria-atomic': ariaAtomic })}
        tabIndex={0}
        testID={testId}
        style={[look.root, fadeIn, style]}
        {...rest}
      >
        {pulse ? <Pulse color={look.palette.main} radius={look.root.borderRadius as number} testID={testIdFor(testId, 'pulse')} /> : null}
        {showIcon ? <IconSlot variant={variant} icon={icon} color={look.iconColor} animate={animate} testID={testIdFor(testId, 'icon')} /> : null}
        <AlertContent title={title} description={description} ink={look.ink} testId={testId}>
          {children}
        </AlertContent>
        {closable ? (
          <View style={actionSlotStyle(theme)}>
            <CloseButton label={closeLabel} ink={look.ink} onPress={dismiss.close} testID={testIdFor(testId, 'close')} />
          </View>
        ) : null}
      </Animated.View>
    </Collapse>
  );
});

Alert.displayName = 'Alert';
