import BrokenImage from '@mui/icons-material/BrokenImage';
import Person from '@mui/icons-material/Person';
import { styled } from '@mui/material/styles/index.js';
import React, { useCallback, useEffect, useState } from 'react';

import {
  AVATAR_DEFAULTS,
  contentTypeOf,
  pickAvatarContent,
  type AvatarContentPick,
} from './Avatar.helpers';
import { GROUP_MAX, GROUP_OVERLAP, GROUP_HOVER, BORDER_WIDTH } from './Avatar.metrics';
import type { AvatarProps, ContentType } from './Avatar.types';
import { AvatarView, type AvatarViewProps } from './Avatar.view';

/** The node behind the winning content slot; the pick itself is shared. */
function resolveContent(args: {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
  icon?: React.ReactNode;
  imageError: boolean;
  showFallbackOnError: boolean;
}): { content: React.ReactNode; contentType: ContentType } {
  const { children, fallback, icon, imageError, showFallbackOnError } = args;
  const pick = pickAvatarContent({
    hasChildren: Boolean(children),
    hasFallback: Boolean(fallback),
    hasIcon: Boolean(icon),
    imageError,
    showFallbackOnError,
  });
  const NODES: Record<AvatarContentPick, React.ReactNode> = {
    children,
    fallback,
    icon,
    broken: <BrokenImage />,
    default: <Person />,
  };
  return { content: NODES[pick], contentType: contentTypeOf(pick) };
}

/** Fades the avatar in after `animationDelay`ms. */
function useMountedFade(animationDelay: number): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), animationDelay);
    return () => window.clearTimeout(timer);
  }, [animationDelay]);
  return mounted;
}

interface ImageState {
  imageError: boolean;
  imageLoading: boolean;
  handleImageError: React.ReactEventHandler;
  handleImageLoad: () => void;
}

/**
 * Tracks the `<img>` load lifecycle. `imageLoading` starts true whenever there is
 * a `src` and clears on load/error — the handlers must be wired to the actual img
 * (via `slotProps.img` in the view), since load/error don't bubble to the root.
 */
function useImageState(src: string | undefined, onError?: React.ReactEventHandler): ImageState {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(!!src);

  useEffect(() => {
    setImageError(false);
    setImageLoading(!!src);
  }, [src]);

  const handleImageError = useCallback<React.ReactEventHandler>(
    (event) => {
      setImageError(true);
      setImageLoading(false);
      onError?.(event);
    },
    [onError],
  );

  const handleImageLoad = useCallback(() => setImageLoading(false), []);

  return { imageError, imageLoading, handleImageError, handleImageLoad };
}

/** Normalizes props (defaults + rest passthrough) and derives everything the view needs. */
function useAvatarModel(raw: AvatarProps, ref: React.Ref<HTMLDivElement>): AvatarViewProps {
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
    interactive,
    showFallbackOnError,
    animationDelay,
    className,
    dataTestId,
    // React Native's spelling of the same id; it names the component on both
    // sides and must not reach the DOM as an attribute.
    testID,
    ...rest
  } = { ...AVATAR_DEFAULTS, ...raw };

  const mounted = useMountedFade(animationDelay);
  const { imageError, imageLoading, handleImageError, handleImageLoad } = useImageState(src, onError);
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => onClick?.(event),
    [onClick],
  );
  const { content, contentType } = resolveContent({
    children,
    fallback,
    icon,
    imageError,
    showFallbackOnError,
  });

  return {
    mounted,
    variant,
    size,
    color,
    glow,
    pulse,
    bordered,
    showSpinner: loading || imageLoading,
    imageError,
    clickable: interactive || !!onClick,
    imgSrc: imageError ? undefined : src,
    alt,
    ariaLabel: (rest['aria-label'] as string) || alt || 'Avatar',
    content,
    contentType,
    className,
    dataTestId: testID ?? dataTestId,
    status,
    forwardedRef: ref,
    onClick: handleClick,
    handleImageError,
    handleImageLoad,
    rest,
  };
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>((props, ref) => (
  <AvatarView {...useAvatarModel(props, ref)} />
));

Avatar.displayName = 'Avatar';

const AvatarGroupContainer = styled('div')<{ overlap?: number }>(({ theme, overlap = GROUP_OVERLAP }) => ({
  display: 'flex',
  alignItems: 'center',
  '& > *': {
    marginLeft: -overlap,
    transition: 'all 0.3s ease',
    position: 'relative',
    border: `${BORDER_WIDTH}px solid ${theme.palette.background.paper}`,
    '&:hover': {
      zIndex: 100,
      transform: `scale(${GROUP_HOVER.scale}) translateY(-${GROUP_HOVER.lift}px)`,
    },
    '&:first-of-type': {
      marginLeft: 0,
    },
  },
}));

// Export AvatarGroup for grouped avatars
export const AvatarGroup: React.FC<{
  children: React.ReactNode;
  max?: number;
  overlap?: number;
  className?: string;
  dataTestId?: string;
}> = ({ children, max = GROUP_MAX, overlap = GROUP_OVERLAP, className, dataTestId }) => {
  const childrenArray = React.Children.toArray(children);
  const visibleChildren = max ? childrenArray.slice(0, max) : childrenArray;
  const remainingCount = childrenArray.length - visibleChildren.length;

  return (
    <AvatarGroupContainer overlap={overlap} className={className} data-testid={dataTestId}>
      {visibleChildren}
      {remainingCount > 0 && (
        <Avatar
          size={(visibleChildren[0] as React.ReactElement<AvatarProps>)?.props?.size || 'md'}
          color="neutral"
          fallback={`+${remainingCount}`}
          bordered
          dataTestId={dataTestId ? `${dataTestId}-overflow` : undefined}
        />
      )}
    </AvatarGroupContainer>
  );
};

AvatarGroup.displayName = 'AvatarGroup';
