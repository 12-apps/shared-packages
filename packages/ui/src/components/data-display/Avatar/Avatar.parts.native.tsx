/**
 * THE PIECES THE NATIVE `Avatar` IS ASSEMBLED FROM.
 *
 * Split out of `Avatar.native.tsx` so the component itself reads as structure:
 * the mount fade, the portrait's load state, the content node, the pulse ring,
 * the spinner and the surface they all sit on.
 */
import * as React from 'react';
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { AvatarSize, AvatarVariant, ContentType } from './Avatar.base';
import type { AvatarContentPick } from './Avatar.helpers';
import {
  avatarLoadingStyle,
  avatarRadius,
  avatarSpinnerStyle,
  avatarSurfaceStyle,
  avatarTextStyle,
} from './Avatar.look.native';
import { AVATAR_SIZES, FADE_MS, GLYPH_SIZE, PULSE, SPINNER } from './Avatar.metrics';
import { Icon } from '../../../icons/Icon.native';
import { useLoopedProgress } from '../../../platform/animation';
import { renderTextChildren } from '../../../platform/text-children';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

const nativeDriver = Platform.OS !== 'web';

/** MUI's `Fade`: in over 300ms, once `animationDelay` has run. */
export function useFadeIn(animationDelay: number): Animated.Value {
  const opacity = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(animationDelay),
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: nativeDriver,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [animationDelay, opacity]);
  return opacity;
}

interface ImageState {
  imageError: boolean;
  imageLoading: boolean;
  handleError: () => void;
  handleLoad: () => void;
}

/** The portrait's load lifecycle: loading from the moment there is a `src`. */
export function useImageState(src: string | undefined, onError?: () => void): ImageState {
  const [imageError, setImageError] = React.useState(false);
  const [imageLoading, setImageLoading] = React.useState(Boolean(src));

  React.useEffect(() => {
    setImageError(false);
    setImageLoading(Boolean(src));
  }, [src]);

  const handleError = React.useCallback(() => {
    setImageError(true);
    setImageLoading(false);
    onError?.();
  }, [onError]);

  return {
    imageError,
    imageLoading,
    handleError,
    handleLoad: React.useCallback(() => setImageLoading(false), []),
  };
}

interface ContentArgs {
  pick: AvatarContentPick;
  children?: React.ReactNode;
  fallback?: string;
  icon?: React.ReactNode;
  ink: string;
}

/** The node behind the winning content slot; the pick itself is shared. */
export function contentNode({ pick, children, fallback, icon, ink }: ContentArgs): React.ReactNode {
  if (pick === 'children') return children;
  if (pick === 'fallback') return fallback;
  if (pick === 'icon') return icon;
  return <Icon name={pick === 'broken' ? 'BrokenImage' : 'Person'} size={GLYPH_SIZE} color={ink} />;
}

/**
 * MUI's `::after` pulse ring: the accent growing 10px past the box while it
 * fades out, every two seconds. React Native has no pseudo-element, so it is a
 * sibling behind the avatar.
 */
export function PulseRing({ size, variant, color }: { size: AvatarSize; variant: AvatarVariant; color: string }): React.JSX.Element {
  const theme = useUiTheme();
  const progress = useLoopedProgress(true, { durationMs: PULSE.durationMs });
  const box = AVATAR_SIZES[size].box;
  return (
    <Animated.View
      aria-hidden
      style={[
        StyleSheet.absoluteFill,
        {
          pointerEvents: 'none',
          borderRadius: avatarRadius(theme, variant, box),
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [PULSE.alpha, 0, 0] }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [1, (box + PULSE.spread * 2) / box, 1],
              }),
            },
          ],
        },
      ]}
    />
  );
}

/** MUI's `rotateAnimation`: the ring turning once every 0.8s. */
function Spinner({ size, testID }: { size: AvatarSize; testID?: string }): React.JSX.Element {
  const theme = useUiTheme();
  const progress = useLoopedProgress(true, { durationMs: SPINNER.durationMs });
  return (
    <Animated.View
      testID={testID}
      style={[
        avatarSpinnerStyle(theme, size),
        {
          transform: [
            { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        },
      ]}
    />
  );
}

export interface SurfaceArgs {
  variant: AvatarVariant;
  size: AvatarSize;
  color: ColorValue;
  glow: boolean;
  bordered: boolean;
  clickable: boolean;
  imageError: boolean;
  showSpinner: boolean;
  imgSrc?: string;
  alt?: string;
  ariaLabel: string;
  content: React.ReactNode;
  contentType: ContentType;
  testID?: string;
  idFor: (suffix: string) => string | undefined;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  onImageError: () => void;
  onImageLoad: () => void;
  rest: object;
}

/** What sits in the middle: the portrait, or the winning content slot. */
function SurfaceInner(a: SurfaceArgs, theme: UiTheme): React.JSX.Element | null {
  if (a.imgSrc && !a.imageError) {
    return (
      <Image
        source={{ uri: a.imgSrc }}
        aria-label={a.alt}
        onError={a.onImageError}
        onLoad={a.onImageLoad}
        style={StyleSheet.absoluteFill}
        accessibilityIgnoresInvertColors
      />
    );
  }
  if (a.showSpinner) return null;
  return (
    <View testID={a.idFor(a.contentType)}>
      {renderTextChildren(a.content, avatarTextStyle(theme, a.size, a.color, a.imageError), 1)}
    </View>
  );
}

/** The avatar box itself, plus the overlay that covers it while it loads. */
export function AvatarSurface(a: SurfaceArgs & { forwardedRef?: React.Ref<View> }): React.JSX.Element {
  const theme = useUiTheme();
  const box = AVATAR_SIZES[a.size].box;
  return (
    <>
      <Pressable
        ref={a.forwardedRef}
        testID={a.testID}
        role={a.clickable ? 'button' : undefined}
        aria-label={a.ariaLabel}
        tabIndex={a.clickable ? 0 : -1}
        onPress={a.clickable ? a.onPress : undefined}
        style={[
          avatarSurfaceStyle(theme, {
            variant: a.variant,
            size: a.size,
            color: a.color,
            glow: a.glow,
            bordered: a.bordered,
            interactive: a.clickable,
            hasError: a.imageError,
          }),
          a.style,
        ]}
        {...a.rest}
      >
        {SurfaceInner(a, theme)}
      </Pressable>
      {a.showSpinner ? (
        <View
          testID={a.idFor('loading')}
          style={avatarLoadingStyle(theme, a.size, avatarRadius(theme, a.variant, box))}
        >
          <Spinner size={a.size} testID={a.idFor('loading-spinner')} />
        </View>
      ) : null}
    </>
  );
}
