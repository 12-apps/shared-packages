import { alpha, Avatar as MuiAvatar, Badge, Fade, keyframes, useTheme } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';
import { styled } from '@mui/material/styles';
import React from 'react';

import type { AvatarSize, AvatarStatus } from './Avatar.types';

export type ContentType = 'children' | 'fallback' | 'icon' | 'default';

const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 10px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

const shimmerAnimation = keyframes`
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
`;

const scaleInAnimation = keyframes`
  0% {
    transform: scale(0);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const rotateAnimation = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

interface PaletteLike {
  main: string;
  contrastText?: string;
  light?: string;
  dark?: string;
}

const getColorFromTheme = (theme: Theme, color: string): PaletteLike => {
  const colorMap: Record<string, PaletteLike> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    // `danger`, not `error`. This map was keyed on MUI's word while the prop
    // took the house one, so `danger` matched nothing and fell through to
    // primary — a red avatar rendering blue, silently.
    danger: theme.palette.error,
    neutral: { main: theme.palette.grey[700], contrastText: '#fff' },
  };

  return colorMap[color] || theme.palette.primary;
};

interface SizeStyle {
  width: number;
  height: number;
  fontSize: string;
}

const getSizeStyles = (size: AvatarSize): SizeStyle => {
  const sizeMap: Record<AvatarSize, SizeStyle> = {
    xs: { width: 24, height: 24, fontSize: '0.75rem' },
    sm: { width: 32, height: 32, fontSize: '0.875rem' },
    md: { width: 40, height: 40, fontSize: '1rem' },
    lg: { width: 48, height: 48, fontSize: '1.125rem' },
    xl: { width: 64, height: 64, fontSize: '1.5rem' },
    xxl: { width: 80, height: 80, fontSize: '2rem' },
  };

  return sizeMap[size] || sizeMap.md;
};

const getStatusColor = (status: AvatarStatus, theme: Theme): string => {
  const statusColorMap: Record<AvatarStatus, string> = {
    online: theme.palette.success.main,
    offline: theme.palette.grey[500],
    away: theme.palette.warning.main,
    busy: theme.palette.error.main,
  };

  return statusColorMap[status] || statusColorMap.offline;
};

/** Hover/active lift, only when the avatar is interactive. */
const interactiveStyles = (interactive: boolean | undefined, main: string): CSSObject =>
  interactive
    ? {
        '&:hover': {
          transform: 'scale(1.1) translateY(-2px)',
          boxShadow: `0 8px 20px ${alpha(main, 0.3)}`,
          filter: 'brightness(1.1)',
          zIndex: 10,
        },
        '&:active': { transform: 'scale(1.05)' },
      }
    : {};

/** Shimmer gradient while the image loads. */
const loadingStyles = (isLoading: boolean | undefined, main: string): CSSObject =>
  isLoading
    ? {
        background: `linear-gradient(
        90deg,
        ${alpha(main, 0.6)},
        ${alpha(main, 0.8)},
        ${alpha(main, 0.6)}
      )`,
        backgroundSize: '200% 100%',
        animation: `${shimmerAnimation} 1.5s ease-in-out infinite`,
      }
    : {};

/** Corner radius per shape variant (circle/status are round). */
const variantRadius = (variant: string | undefined, theme: Theme): CSSObject => {
  if (variant === 'square') return { borderRadius: 0 };
  if (variant === 'rounded') return { borderRadius: theme.spacing(1) };
  return { borderRadius: '50%' };
};

/** Paper ring when bordered (e.g. inside an AvatarGroup). */
const borderedStyles = (bordered: boolean | undefined, theme: Theme): CSSObject =>
  bordered
    ? {
        border: `2px solid ${theme.palette.background.paper}`,
        boxShadow: `0 0 0 1px ${alpha(theme.palette.divider, 0.2)}`,
      }
    : {};

/** Glow adds the halo; pulse adds the expanding ring — either or both. */
const glowPulseStyles = (
  glow: boolean | undefined,
  pulse: boolean | undefined,
  main: string,
): CSSObject => {
  const styles: CSSObject = {};
  if (glow) {
    styles.boxShadow = `0 0 20px 5px ${alpha(main, 0.4)} !important`;
    styles.filter = 'brightness(1.05)';
  }
  if (pulse) {
    styles.position = 'relative';
    styles['&::after'] = {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: '100%',
      height: '100%',
      borderRadius: 'inherit',
      transform: 'translate(-50%, -50%)',
      backgroundColor: main,
      opacity: 0.3,
      animation: `${pulseAnimation} 2s infinite`,
      pointerEvents: 'none',
      zIndex: -1,
    };
  }
  return styles;
};

interface StyledAvatarProps {
  customVariant?: string;
  customSize?: AvatarSize;
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
  bordered?: boolean;
  isLoading?: boolean;
  hasError?: boolean;
  interactive?: boolean;
}

const STYLED_AVATAR_PROPS = [
  'customVariant',
  'customSize',
  'customColor',
  'glow',
  'pulse',
  'bordered',
  'isLoading',
  'hasError',
  'interactive',
];

const StyledAvatar = styled(MuiAvatar, {
  shouldForwardProp: (prop) => !STYLED_AVATAR_PROPS.includes(prop as string),
})<StyledAvatarProps>(
  ({
    theme,
    customVariant,
    customSize = 'md',
    customColor = 'primary',
    glow,
    pulse,
    bordered,
    isLoading,
    hasError,
    interactive,
  }) => {
    const palette = getColorFromTheme(theme, customColor);
    return {
      ...getSizeStyles(customSize),
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      position: 'relative',
      overflow: 'visible',
      animation: `${scaleInAnimation} 0.3s ease-out`,
      cursor: interactive ? 'pointer' : 'default',
      backgroundColor: hasError ? theme.palette.error.main : palette.main,
      color: hasError ? theme.palette.error.contrastText : (palette.contrastText ?? '#fff'),
      ...interactiveStyles(interactive, palette.main),
      ...loadingStyles(isLoading, palette.main),
      ...variantRadius(customVariant, theme),
      ...borderedStyles(bordered, theme),
      ...glowPulseStyles(glow, pulse, palette.main),
      '&:focus-visible': {
        outline: `3px solid ${alpha(palette.main, 0.5)}`,
        outlineOffset: 2,
      },
    };
  },
);

const LoadingOverlay = styled('div')<{ size: AvatarSize }>(({ theme, size }) => {
  const sizeStyles = getSizeStyles(size);
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: sizeStyles.width,
    height: sizeStyles.height,
    borderRadius: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(theme.palette.background.paper, 0.7),
    backdropFilter: 'blur(2px)',
    '& .loading-spinner': {
      width: sizeStyles.width * 0.4,
      height: sizeStyles.height * 0.4,
      border: `2px solid ${alpha(theme.palette.primary.main, 0.3)}`,
      borderTopColor: theme.palette.primary.main,
      borderRadius: '50%',
      animation: `${rotateAnimation} 0.8s linear infinite`,
    },
  };
});

const StatusBadge = styled(Badge, {
  shouldForwardProp: (prop) => !['statusColor', 'avatarSize'].includes(prop as string),
})<{
  statusColor?: string;
  avatarSize?: AvatarSize;
}>(({ theme, statusColor, avatarSize = 'md' }) => {
  const sizeStyles = getSizeStyles(avatarSize);
  const badgeSize = Math.max(8, sizeStyles.width * 0.2);

  return {
    '& .MuiBadge-badge': {
      backgroundColor: statusColor || theme.palette.success.main,
      color: statusColor || theme.palette.success.main,
      width: badgeSize,
      height: badgeSize,
      borderRadius: '50%',
      border: `2px solid ${theme.palette.background.paper}`,
      '&::after': {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        backgroundColor: 'currentColor',
        content: '""',
      },
    },
  };
});

export interface AvatarViewProps {
  mounted: boolean;
  variant: string;
  size: AvatarSize;
  color: string;
  glow: boolean;
  pulse: boolean;
  bordered: boolean;
  showSpinner: boolean;
  imageError: boolean;
  clickable: boolean;
  imgSrc?: string;
  alt?: string;
  ariaLabel: string;
  content: React.ReactNode;
  contentType: ContentType;
  className?: string;
  dataTestId?: string;
  status?: AvatarStatus;
  forwardedRef: React.Ref<HTMLDivElement>;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleImageError: React.ReactEventHandler;
  handleImageLoad: () => void;
  rest: Record<string, unknown>;
}

/** The avatar box itself: the styled MUI avatar plus the loading overlay. */
function AvatarSurface(props: AvatarViewProps): React.JSX.Element {
  const { showSpinner, dataTestId, clickable } = props;
  const testId = (suffix: string): string | undefined =>
    dataTestId ? `${dataTestId}-${suffix}` : undefined;

  return (
    <Fade in={props.mounted} timeout={300}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <StyledAvatar
          ref={props.forwardedRef}
          className={props.className}
          customVariant={props.variant}
          customSize={props.size}
          customColor={props.color}
          glow={props.glow}
          pulse={props.pulse}
          bordered={props.bordered}
          isLoading={showSpinner}
          hasError={props.imageError}
          interactive={clickable}
          src={props.imgSrc}
          alt={props.alt}
          onClick={props.onClick}
          tabIndex={clickable ? 0 : undefined}
          role={clickable ? 'button' : undefined}
          aria-label={props.ariaLabel}
          data-testid={dataTestId}
          {...props.rest}
          // Load/error fire on the inner <img>, not the root — and don't bubble.
          // Wiring them via the img slot lets `imageLoading` actually clear (else
          // the spinner overlays the avatar forever whenever `src` is set). Keep
          // after {...props.rest} so a consumer-supplied slotProps can't override
          // and detach these handlers.
          slotProps={{ img: { onError: props.handleImageError, onLoad: props.handleImageLoad } }}
        >
          {showSpinner ? null : (
            <span data-testid={testId(props.contentType)}>{props.content}</span>
          )}
        </StyledAvatar>
        {showSpinner && (
          <LoadingOverlay size={props.size} data-testid={testId('loading')}>
            <div className="loading-spinner" data-testid={testId('loading-spinner')} />
          </LoadingOverlay>
        )}
      </div>
    </Fade>
  );
}

/** Presentational avatar: the surface, wrapped in a status dot badge when requested. */
export function AvatarView(props: AvatarViewProps): React.JSX.Element {
  const theme = useTheme();
  const surface = <AvatarSurface {...props} />;

  if (props.variant === 'status' && props.status) {
    return (
      <StatusBadge
        overlap="circular"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        variant="dot"
        statusColor={getStatusColor(props.status, theme)}
        avatarSize={props.size}
        data-testid={props.dataTestId ? `${props.dataTestId}-badge` : undefined}
      >
        {surface}
      </StatusBadge>
    );
  }

  return surface;
}
