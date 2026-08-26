import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import { alpha } from '@mui/material/styles/index.js';

import type { ScrollAreaProps } from './ScrollArea.types';

const SCROLLBAR_SIZES: Record<string, number> = {
  thin: 8,
  thick: 16,
};

const DEFAULT_SCROLLBAR_SIZE = 12;

// thin/thick are the named ends of the scale; anything else takes the default.
const getScrollbarSize = (scrollbarSize?: string): number =>
  scrollbarSize ? (SCROLLBAR_SIZES[scrollbarSize] ?? DEFAULT_SCROLLBAR_SIZE) : DEFAULT_SCROLLBAR_SIZE;

const getScrollbarColors = ({
  theme,
  variant,
  scrollbarColor,
  scrollbarTrackColor,
}: {
  theme: Theme;
  variant?: string;
  scrollbarColor?: string;
  scrollbarTrackColor?: string;
}) => {
  const defaultScrollbarColor =
    variant === 'glass'
      ? alpha(theme.palette.primary.main, 0.5)
      : theme.palette.mode === 'dark'
        ? theme.palette.grey[600]
        : theme.palette.grey[400];

  const defaultTrackColor =
    variant === 'glass'
      ? alpha(theme.palette.background.paper, 0.1)
      : theme.palette.mode === 'dark'
        ? theme.palette.grey[900]
        : theme.palette.grey[200];

  return {
    scrollbar: scrollbarColor || defaultScrollbarColor,
    track: scrollbarTrackColor || defaultTrackColor,
  };
};

export const getOverflowStyle = ({
  disabled,
  orientation,
}: {
  disabled?: boolean;
  orientation?: ScrollAreaProps['orientation'];
}) => {
  if (disabled) return { overflow: 'hidden' as const };

  switch (orientation) {
    case 'horizontal':
      return {
        overflow: 'hidden' as const,
        overflowX: 'auto' as const,
        overflowY: 'hidden' as const,
      };
    case 'both':
      return { overflow: 'auto' as const };
    default:
      return {
        overflow: 'hidden' as const,
        overflowY: 'auto' as const,
        overflowX: 'hidden' as const,
      };
  }
};

// Scrollbar chrome shared by every variant. autoHide fades the thumb out when
// the area is idle, which is why the colours are parameters rather than read
// from the variant directly.
const autoHideScrollbarStyles = ({
  thumbColor,
  trackColor,
  size,
  orientation,
  shouldShowScrollbar,
  theme,
  scrollbarSize,
}: {
  thumbColor: string;
  trackColor: string;
  size: number;
  orientation?: ScrollAreaProps['orientation'];
  shouldShowScrollbar: boolean;
  theme: Theme;
  scrollbarSize?: string;
}) => ({
    '&::-webkit-scrollbar': {
      width: orientation !== 'horizontal' ? size : '100%',
      height: orientation !== 'vertical' ? size : '100%',
    },
    '&::-webkit-scrollbar-track': {
      background: shouldShowScrollbar ? trackColor : 'transparent',
      borderRadius: size / 2,
      transition: 'background 0.3s ease',
    },
    '&::-webkit-scrollbar-thumb': {
      background: shouldShowScrollbar ? thumbColor : 'transparent',
      borderRadius: size / 2,
      transition: 'background 0.3s ease',
      '&:hover': {
        background: shouldShowScrollbar ? theme.palette.primary.main : 'transparent',
      },
    },
    '&::-webkit-scrollbar-corner': {
      background: shouldShowScrollbar ? trackColor : 'transparent',
    },
    // Firefox scrollbar styling
    scrollbarWidth: shouldShowScrollbar
      ? scrollbarSize === 'thin'
        ? ('thin' as const)
        : ('auto' as const)
      : ('none' as const),
    scrollbarColor: shouldShowScrollbar
      ? `${thumbColor} ${trackColor}`
      : 'transparent transparent',
  });

type VariantArgs = {
  theme: Theme;
  colors: { scrollbar: string; track: string };
  size: number;
  orientation?: ScrollAreaProps['orientation'];
  shouldShowScrollbar: boolean;
  scrollbarSize?: string;
};

// One entry per scrollbar look. overlay floats above the content, glass tints
// it, and the default delegates to the shared auto-hide chrome.
const VARIANT_SCROLLBARS: Record<string, (args: VariantArgs) => CSSObject> = {
  overlay: ({ theme, colors, size, orientation, shouldShowScrollbar, scrollbarSize }) => ({
          '&::-webkit-scrollbar': {
            width: orientation !== 'horizontal' ? size : '100%',
            height: orientation !== 'vertical' ? size : '100%',
            position: 'absolute',
            right: 0,
            top: 0,
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
            borderRadius: size / 2,
          },
          '&::-webkit-scrollbar-thumb': {
            background: shouldShowScrollbar
              ? alpha(colors.scrollbar, 0.5)
              : 'transparent',
            borderRadius: size / 2,
            transition: 'background 0.3s ease',
            border: '2px solid transparent',
            backgroundClip: 'padding-box',
            '&:hover': {
              background: shouldShowScrollbar ? theme.palette.primary.main : 'transparent',
            },
          },
          '&::-webkit-scrollbar-corner': {
            background: 'transparent',
          },
          scrollbarWidth: shouldShowScrollbar
            ? scrollbarSize === 'thin'
              ? ('thin' as const)
              : ('auto' as const)
            : ('none' as const),
          scrollbarColor: shouldShowScrollbar
            ? `${alpha(colors.scrollbar, 0.5)} transparent`
            : 'transparent transparent',
        }),

  // Starts from the shared chrome, then adds what makes it glass: a blurred
  // track and root, and an inner highlight on the thumb. scrollbar-color (the
  // Firefox property) keeps the solid palette colour rather than the gradient —
  // a gradient is not a valid value there, which is why the original picked
  // colors.scrollbar for it.
  glass: ({ theme, colors, size, orientation, shouldShowScrollbar, scrollbarSize }) => {
    const glassThumbColor = `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.3)}, ${alpha(theme.palette.secondary.main, 0.3)})`;
    const glassTrackColor = alpha(theme.palette.background.paper, 0.1);

    const base = autoHideScrollbarStyles({
      thumbColor: glassThumbColor,
      trackColor: glassTrackColor,
      size,
      orientation,
      shouldShowScrollbar,
      theme,
      scrollbarSize,
    });

    return {
      ...base,
      '&::-webkit-scrollbar-track': {
        ...(base['&::-webkit-scrollbar-track'] as object),
        backdropFilter: shouldShowScrollbar ? 'blur(5px)' : 'none',
      },
      '&::-webkit-scrollbar-thumb': {
        ...(base['&::-webkit-scrollbar-thumb'] as object),
        boxShadow: shouldShowScrollbar
          ? `inset 0 0 6px ${alpha(theme.palette.common.white, 0.3)}`
          : 'none',
      },
      scrollbarColor: shouldShowScrollbar
        ? `${colors.scrollbar} ${glassTrackColor}`
        : 'transparent transparent',
      backdropFilter: 'blur(10px)',
    };
  },

  default: ({ theme, colors, size, orientation, shouldShowScrollbar, scrollbarSize }) =>
    autoHideScrollbarStyles({
      thumbColor: colors.scrollbar,
      trackColor: colors.track,
      size,
      orientation,
      shouldShowScrollbar,
      theme,
      scrollbarSize,
    }),
};

export const getVariantStyles = ({
  theme,
  variant,
  orientation,
  scrollbarSize,
  scrollbarColor,
  scrollbarTrackColor,
  shouldShowScrollbar,
}: {
  theme: Theme;
  variant?: string;
  orientation?: ScrollAreaProps['orientation'];
  scrollbarSize?: string;
  scrollbarColor?: string;
  scrollbarTrackColor?: string;
  shouldShowScrollbar: boolean;
}) => {
  const colors = getScrollbarColors({ theme, variant, scrollbarColor, scrollbarTrackColor });
  const size = getScrollbarSize(scrollbarSize);

  const build = VARIANT_SCROLLBARS[variant ?? 'default'] ?? VARIANT_SCROLLBARS.default!;

  return build({ theme, colors, size, orientation, shouldShowScrollbar, scrollbarSize });
};
