import MuiAvatar from '@mui/material/Avatar/index.js';
import Badge from '@mui/material/Badge/index.js';
import Fade from '@mui/material/Fade/index.js';
import { alpha, useTheme, styled } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { pulseAnimation, rotateAnimation, scaleInAnimation, shimmerAnimation } from './Avatar.animations';
import {
  AVATAR_SIZES,
  AVATAR_TRANSITION_EASING,
  AVATAR_TRANSITION_MS,
  ACTIVE_SCALE,
  BORDER_HALO_ALPHA,
  BORDER_WIDTH,
  FADE_MS,
  FOCUS_RING,
  GLOW,
  HOVER,
  LOADING_OVERLAY,
  PULSE,
  ROUNDED_RADIUS_UNITS,
  SCALE_IN_MS,
  SHIMMER,
  SPINNER,
  STATUS_DOT,
} from './Avatar.metrics';
import type { AvatarSize, AvatarStatus, ContentType } from './Avatar.types';
import { absoluteInk, controlNeutral, neutralTones } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

export type { ContentType };


interface PaletteLike {
  main: string;
  contrastText?: string;
  light?: string;
  dark?: string;
}

const getColorFromTheme = (theme: Theme, color: string): PaletteLike => {
  const neutral = controlNeutral(theme);
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
    neutral: { main: neutral.main, contrastText: neutral.contrastText },
  };

  return colorMap[color] || theme.palette.primary;
};

// Read from the shared metrics, not restated: the native `Avatar` reads the
// same table, so the two renderers cannot disagree on a box. Design px; every
// read below draws it through the type scale.
const boxPx = (size: AvatarSize): number => (AVATAR_SIZES[size] || AVATAR_SIZES.md).box;

/** The square box, as rem through the theme. */
const boxStyles = (theme: Theme, size: AvatarSize): CSSObject => {
  const side = rem(theme, boxPx(size));
  return { width: side, height: side };
};

/** The glyph size in design px, read through the type scale where it is drawn. */
const glyphPx = (size: AvatarSize): number => (AVATAR_SIZES[size] || AVATAR_SIZES.md).fontSize;

const getStatusColor = (status: AvatarStatus, theme: Theme): string => {
  // The same four decisions the native half reads out of `Avatar.metrics`,
  // against MUI's `Theme` rather than the shared one.
  const statusColorMap: Record<AvatarStatus, string> = {
    online: theme.palette.success.main,
    offline: neutralTones(theme).muted,
    away: theme.palette.warning.main,
    busy: theme.palette.error.main,
  };

  return statusColorMap[status] || statusColorMap.offline;
};

/** Hover/active lift, only when the avatar is interactive. */
const interactiveStyles = (theme: Theme, interactive: boolean | undefined, main: string): CSSObject =>
  interactive
    ? {
        '&:hover': {
          transform: `scale(${HOVER.scale}) translateY(${rem(theme, -HOVER.lift)})`,
          boxShadow: `0 ${rems(theme, HOVER.shadowY, HOVER.shadowBlur)} ${alpha(main, HOVER.shadowAlpha)}`,
          filter: `brightness(${HOVER.brightness})`,
          zIndex: 10,
        },
        '&:active': { transform: `scale(${ACTIVE_SCALE})` },
      }
    : {};

/** Shimmer gradient while the image loads. */
const loadingStyles = (isLoading: boolean | undefined, main: string): CSSObject =>
  isLoading
    ? {
        background: `linear-gradient(
        90deg,
        ${alpha(main, SHIMMER.fromAlpha)},
        ${alpha(main, SHIMMER.toAlpha)},
        ${alpha(main, SHIMMER.fromAlpha)}
      )`,
        backgroundSize: '200% 100%',
        animation: `${shimmerAnimation} ${SHIMMER.durationMs / 1000}s ease-in-out infinite`,
      }
    : {};

/** Corner radius per shape variant (circle/status are round). */
const variantRadius = (variant: string | undefined, theme: Theme): CSSObject => {
  if (variant === 'square') return { borderRadius: 0 };
  if (variant === 'rounded') return { borderRadius: theme.spacing(ROUNDED_RADIUS_UNITS) };
  return { borderRadius: '50%' };
};

/** Paper ring when bordered (e.g. inside an AvatarGroup). */
const borderedStyles = (bordered: boolean | undefined, theme: Theme): CSSObject =>
  bordered
    ? {
        border: `${rem(theme, BORDER_WIDTH)} solid ${theme.palette.background.paper}`,
        boxShadow: `0 0 0 ${rem(theme, 1)} ${alpha(theme.palette.divider, BORDER_HALO_ALPHA)}`,
      }
    : {};

/** Glow adds the halo; pulse adds the expanding ring — either or both. */
const glowPulseStyles = (
  theme: Theme,
  glow: boolean | undefined,
  pulse: boolean | undefined,
  main: string,
): CSSObject => {
  const styles: CSSObject = {};
  if (glow) {
    styles.boxShadow = `0 0 ${rems(theme, GLOW.blur, GLOW.spread)} ${alpha(main, GLOW.alpha)} !important`;
    styles.filter = `brightness(${GLOW.brightness})`;
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
      opacity: PULSE.alpha,
      animation: `${pulseAnimation(theme)} ${PULSE.durationMs / 1000}s infinite`,
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
      ...boxStyles(theme, customSize),
      fontSize: rem(theme, glyphPx(customSize)),
      transition: `all ${AVATAR_TRANSITION_MS / 1000}s ${AVATAR_TRANSITION_EASING}`,
      position: 'relative',
      overflow: 'visible',
      animation: `${scaleInAnimation} ${SCALE_IN_MS / 1000}s ease-out`,
      cursor: interactive ? 'pointer' : 'default',
      backgroundColor: hasError ? theme.palette.error.main : palette.main,
      color: hasError ? theme.palette.error.contrastText : (palette.contrastText ?? absoluteInk(theme).white),
      ...interactiveStyles(theme, interactive, palette.main),
      ...loadingStyles(isLoading, palette.main),
      ...variantRadius(customVariant, theme),
      ...borderedStyles(bordered, theme),
      ...glowPulseStyles(theme, glow, pulse, palette.main),
      '&:focus-visible': {
        outline: `${rem(theme, FOCUS_RING.width)} solid ${alpha(palette.main, FOCUS_RING.alpha)}`,
        outlineOffset: rem(theme, FOCUS_RING.offset),
      },
    };
  },
);

const LoadingOverlay = styled('div')<{ size: AvatarSize }>(({ theme, size }) => {
  const box = boxPx(size);
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    ...boxStyles(theme, size),
    borderRadius: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(theme.palette.background.paper, LOADING_OVERLAY.paperAlpha),
    backdropFilter: `blur(${rem(theme, LOADING_OVERLAY.blur)})`,
    '& .loading-spinner': {
      width: rem(theme, box * SPINNER.scale),
      height: rem(theme, box * SPINNER.scale),
      border: `${rem(theme, SPINNER.ringWidth)} solid ${alpha(theme.palette.primary.main, SPINNER.trackAlpha)}`,
      borderTopColor: theme.palette.primary.main,
      borderRadius: '50%',
      animation: `${rotateAnimation} ${SPINNER.durationMs / 1000}s linear infinite`,
    },
  };
});

const StatusBadge = styled(Badge, {
  shouldForwardProp: (prop) => !['statusColor', 'avatarSize'].includes(prop as string),
})<{
  statusColor?: string;
  avatarSize?: AvatarSize;
}>(({ theme, statusColor, avatarSize = 'md' }) => {
  const badgeSize = rem(theme, Math.max(STATUS_DOT.min, boxPx(avatarSize) * STATUS_DOT.scale));

  return {
    '& .MuiBadge-badge': {
      backgroundColor: statusColor || theme.palette.success.main,
      color: statusColor || theme.palette.success.main,
      width: badgeSize,
      height: badgeSize,
      borderRadius: '50%',
      border: `${rem(theme, STATUS_DOT.borderWidth)} solid ${theme.palette.background.paper}`,
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
    <Fade in={props.mounted} timeout={FADE_MS}>
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
