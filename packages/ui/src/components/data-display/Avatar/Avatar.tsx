import BrokenImage from '@mui/icons-material/BrokenImage';
import Person from '@mui/icons-material/Person';
import { styled } from '@mui/material/styles/index.js';
import React, { useCallback, useEffect, useState } from 'react';

import type { AvatarProps } from './Avatar.types';
import { AvatarView, type AvatarViewProps, type ContentType } from './Avatar.view';

/** Applied via a single spread so no per-field default inflates cyclomatic complexity. */
const AVATAR_DEFAULTS = {
  variant: 'circle',
  size: 'md',
  glow: false,
  pulse: false,
  bordered: false,
  color: 'primary',
  loading: false,
  interactive: false,
  showFallbackOnError: true,
  animationDelay: 0,
} satisfies Partial<AvatarProps>;

/**
 * Pick what renders inside the avatar. On an image error (with fallback enabled)
 * the fallback/icon/broken-image wins; otherwise children → fallback → icon → the
 * default person glyph.
 */
function resolveContent(args: {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
  icon?: React.ReactNode;
  imageError: boolean;
  showFallbackOnError: boolean;
}): { content: React.ReactNode; contentType: ContentType } {
  const { children, fallback, icon, imageError, showFallbackOnError } = args;
  if (imageError && showFallbackOnError) {
    if (fallback) return { content: fallback, contentType: 'fallback' };
    if (icon) return { content: icon, contentType: 'icon' };
    return { content: <BrokenImage />, contentType: 'icon' };
  }
  if (children) return { content: children, contentType: 'children' };
  if (fallback) return { content: fallback, contentType: 'fallback' };
  if (icon) return { content: icon, contentType: 'icon' };
  return { content: <Person />, contentType: 'default' };
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
    dataTestId,
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

const AvatarGroupContainer = styled('div')<{ overlap?: number }>(({ theme, overlap = 8 }) => ({
  display: 'flex',
  alignItems: 'center',
  '& > *': {
    marginLeft: -overlap,
    transition: 'all 0.3s ease',
    position: 'relative',
    border: `2px solid ${theme.palette.background.paper}`,
    '&:hover': {
      zIndex: 100,
      transform: 'scale(1.1) translateY(-4px)',
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
}> = ({ children, max = 4, overlap = 8, className, dataTestId }) => {
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
