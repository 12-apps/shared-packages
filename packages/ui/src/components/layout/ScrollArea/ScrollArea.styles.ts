import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import { alpha } from '@mui/material/styles/index.js';

import type { ScrollAreaProps } from './ScrollArea.types';
import { neutralTones, sheen } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

/** The scrollbar's thickness in design px, per `scrollbarSize`; `default` is the fallback. */
const SCROLLBAR_SIZES: Record<string, number> = {
  thin: 8,
  thick: 16,
  default: 12,
};

// thin/thick are the named ends of the scale; anything else takes the default.
const getScrollbarSize = (scrollbarSize?: string): number =>
  (scrollbarSize ? SCROLLBAR_SIZES[scrollbarSize] : undefined) ?? SCROLLBAR_SIZES.default!;

/**
 * A size prop as CSS. `sx` reads a number of 1 or less as a fraction of the
 * parent, and that stays so; any other number is design px, through the type
 * scale; a string is as given.
 */
export const sizeCss = (theme: Theme, value: number | string | undefined): string | undefined => {
  if (typeof value !== 'number') return value;
  return value <= 1 && value !== 0 ? `${value * 100}%` : rem(theme, value);
};

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
        ? neutralTones(theme).emphasis
        : neutralTones(theme).subtle;

  const defaultTrackColor =
    variant === 'glass'
      ? alpha(theme.palette.background.paper, 0.1)
      : theme.palette.mode === 'dark'
        ? neutralTones(theme).inverseSurface
        : neutralTones(theme).faint;

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
// from the variant directly. An `sx` object (it is spread into the viewport's
// `sx`), so a number on `borderRadius` is a multiple of `shape.borderRadius`.
const autoHideScrollbarSx = ({
  thumbColor,
  trackColor,
  thickness,
  orientation,
  shouldShowScrollbar,
  theme,
  scrollbarSize,
}: {
  thumbColor: string;
  trackColor: string;
  thickness: number;
  orientation?: ScrollAreaProps['orientation'];
  shouldShowScrollbar: boolean;
  theme: Theme;
  scrollbarSize?: string;
}) => ({
    '&::-webkit-scrollbar': {
      width: orientation !== 'horizontal' ? rem(theme, thickness) : '100%',
      height: orientation !== 'vertical' ? rem(theme, thickness) : '100%',
    },
    '&::-webkit-scrollbar-track': {
      background: shouldShowScrollbar ? trackColor : 'transparent',
      borderRadius: thickness / 2,
      transition: 'background 0.3s ease',
    },
    '&::-webkit-scrollbar-thumb': {
      background: shouldShowScrollbar ? thumbColor : 'transparent',
      borderRadius: thickness / 2,
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
  thickness: number;
  orientation?: ScrollAreaProps['orientation'];
  shouldShowScrollbar: boolean;
  scrollbarSize?: string;
};

// One entry per scrollbar look. overlay floats above the content, glass tints
// it, and the default delegates to the shared auto-hide chrome. Each is an `sx`
// object, like the chrome.
const VARIANT_SCROLLBAR_SX: Record<string, (args: VariantArgs) => CSSObject> = {
  overlay: ({ theme, colors, thickness, orientation, shouldShowScrollbar, scrollbarSize }) => ({
          '&::-webkit-scrollbar': {
            width: orientation !== 'horizontal' ? rem(theme, thickness) : '100%',
            height: orientation !== 'vertical' ? rem(theme, thickness) : '100%',
            position: 'absolute',
            right: 0,
            top: 0,
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
            borderRadius: thickness / 2,
          },
          '&::-webkit-scrollbar-thumb': {
            background: shouldShowScrollbar
              ? alpha(colors.scrollbar, 0.5)
              : 'transparent',
            borderRadius: thickness / 2,
            transition: 'background 0.3s ease',
            border: `${rem(theme, 2)} solid transparent`,
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
  glass: ({ theme, colors, thickness, orientation, shouldShowScrollbar, scrollbarSize }) => {
    const glassThumbColor = `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.3)}, ${alpha(theme.palette.secondary.main, 0.3)})`;
    const glassTrackColor = alpha(theme.palette.background.paper, 0.1);

    const base = autoHideScrollbarSx({
      thumbColor: glassThumbColor,
      trackColor: glassTrackColor,
      thickness,
      orientation,
      shouldShowScrollbar,
      theme,
      scrollbarSize,
    });

    return {
      ...base,
      '&::-webkit-scrollbar-track': {
        ...(base['&::-webkit-scrollbar-track'] as object),
        backdropFilter: shouldShowScrollbar ? `blur(${rem(theme, 5)})` : 'none',
      },
      '&::-webkit-scrollbar-thumb': {
        ...(base['&::-webkit-scrollbar-thumb'] as object),
        boxShadow: shouldShowScrollbar
          ? `inset ${rems(theme, 0, 0, 6)} ${sheen(theme, 0.3)}`
          : 'none',
      },
      scrollbarColor: shouldShowScrollbar
        ? `${colors.scrollbar} ${glassTrackColor}`
        : 'transparent transparent',
      backdropFilter: `blur(${rem(theme, 10)})`,
    };
  },

  default: ({ theme, colors, thickness, orientation, shouldShowScrollbar, scrollbarSize }) =>
    autoHideScrollbarSx({
      thumbColor: colors.scrollbar,
      trackColor: colors.track,
      thickness,
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
  const thickness = getScrollbarSize(scrollbarSize);

  const build = VARIANT_SCROLLBAR_SX[variant ?? 'default'] ?? VARIANT_SCROLLBAR_SX.default!;

  return build({ theme, colors, thickness, orientation, shouldShowScrollbar, scrollbarSize });
};
