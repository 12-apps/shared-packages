import * as React from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import type { AvatarSize, AvatarVariant } from './Avatar.base';
import {
  AVATAR_DEFAULTS,
  avatarTestId,
  contentTypeOf,
  pickAvatarContent,
} from './Avatar.helpers';
import { avatarStatusDotStyle } from './Avatar.look.native';
import { GROUP_MAX, GROUP_OVERLAP, avatarAccent, statusColor } from './Avatar.metrics';
import {
  AvatarSurface,
  PulseRing,
  contentNode,
  useFadeIn,
  useImageState,
  type SurfaceArgs,
} from './Avatar.parts.native';
import type { AvatarGroupProps, AvatarProps } from './Avatar.types.native';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { ColorValue } from '../../../tokens/vocabulary';

interface AvatarModel {
  args: SurfaceArgs;
  variant: AvatarVariant;
  size: AvatarSize;
  color: ColorValue;
  pulse: boolean;
  status?: AvatarProps['status'];
  opacity: Animated.Value;
  badgeTestID?: string;
}

/** Normalises the props and derives everything the surface needs, as the web's model does. */
function useAvatarModel(raw: AvatarProps): AvatarModel {
  const {
    variant,
    size,
    glow,
    pulse,
    status,
    fallback,
    icon,
    bordered,
    color,
    src,
    alt,
    children,
    loading,
    onError,
    onClick,
    onPress,
    interactive,
    showFallbackOnError,
    animationDelay,
    dataTestId,
    testID,
    style,
    ...rest
  } = { ...AVATAR_DEFAULTS, ...raw };
  const theme = useUiTheme();
  const opacity = useFadeIn(animationDelay);
  const { imageError, imageLoading, handleError, handleLoad } = useImageState(src, onError);
  const pick = pickAvatarContent({
    hasChildren: Boolean(children),
    hasFallback: Boolean(fallback),
    hasIcon: Boolean(icon),
    imageError,
    showFallbackOnError,
  });
  const avatarId = testID ?? dataTestId;
  const idFor = avatarTestId(avatarId);

  return {
    variant,
    size,
    color,
    pulse,
    status,
    opacity,
    badgeTestID: idFor('badge'),
    args: {
      variant,
      size,
      color,
      glow,
      bordered,
      clickable: interactive || Boolean(onClick ?? onPress),
      imageError,
      showSpinner: loading || imageLoading,
      imgSrc: imageError ? undefined : src,
      alt,
      ariaLabel: alt || 'Avatar',
      content: contentNode({
        pick,
        children,
        fallback,
        icon,
        ink: avatarAccent(theme, color).contrastText,
      }),
      contentType: contentTypeOf(pick),
      testID: avatarId,
      idFor,
      style,
      onPress: (event) => {
        onClick?.();
        onPress?.(event);
      },
      onImageError: handleError,
      onImageLoad: handleLoad,
      rest,
    },
  };
}

/**
 * The native `Avatar`: MUI's box on a `Pressable`, the portrait as an `Image`,
 * and the status dot as a bordered circle in the corner.
 */
export const Avatar = React.forwardRef<View, AvatarProps>((raw, ref) => {
  const theme = useUiTheme();
  const { args, variant, size, color, pulse, status, opacity, badgeTestID } = useAvatarModel(raw);

  const surface = (
    <Animated.View style={[styles.relative, { opacity }]}>
      {pulse ? (
        <PulseRing size={size} variant={variant} color={avatarAccent(theme, color).main} />
      ) : null}
      <AvatarSurface {...args} forwardedRef={ref} />
    </Animated.View>
  );

  if (variant !== 'status' || !status) return surface;

  return (
    <View testID={badgeTestID} style={styles.relative}>
      {surface}
      <View style={avatarStatusDotStyle(theme, size, statusColor(theme, status))} />
    </View>
  );
});

Avatar.displayName = 'Avatar';

/**
 * The native `AvatarGroup`: the same overlap, and the same `+n` avatar past
 * `max`. The web additionally lifts an avatar on hover, which touch has none of.
 */
export const AvatarGroup: React.FC<AvatarGroupProps> = ({
  children,
  max = GROUP_MAX,
  overlap = GROUP_OVERLAP,
  dataTestId,
  testID,
  style,
}) => {
  const all = React.Children.toArray(children);
  const visible = max ? all.slice(0, max) : all;
  const remaining = all.length - visible.length;
  const groupId = testID ?? dataTestId;

  return (
    <View testID={groupId} style={[styles.group, style]}>
      {visible.map((child, index) => (
        <View key={`avatar-${index}`} style={index === 0 ? null : { marginLeft: -overlap }}>
          {child}
        </View>
      ))}
      {remaining > 0 ? (
        <View style={{ marginLeft: -overlap }}>
          <Avatar
            color="neutral"
            fallback={`+${remaining}`}
            bordered
            dataTestId={groupId ? `${groupId}-overflow` : undefined}
          />
        </View>
      ) : null}
    </View>
  );
};

AvatarGroup.displayName = 'AvatarGroup';

const styles = StyleSheet.create({
  relative: { position: 'relative', alignSelf: 'flex-start' },
  group: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
});
