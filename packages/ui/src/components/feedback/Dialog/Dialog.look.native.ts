import type { ViewStyle } from 'react-native';

import type { DialogBorderRadius, DialogSize, DialogVariant } from './Dialog.base';
import {
  DIALOG_BACKDROP,
  DIALOG_BORDER_WIDTH,
  DIALOG_GLASS,
  DIALOG_GLOW,
  DIALOG_MARGIN_UNITS,
  DIALOG_MAX_WIDTH,
  DIALOG_PAPER_SHADOW,
  DIALOG_RADIUS_UNITS,
} from './Dialog.metrics';
import { alpha } from '../../../tokens/color';
import type { UiShadow } from '../../../tokens/shadow';
import type { UiTheme } from '../../../tokens/theme';

/**
 * WHAT THE NATIVE `Dialog` PAINTS — the arithmetic, with no JSX in sight.
 *
 * `variantStylesOf` builds one `sx` by spreading base, then the decorations
 * (`glow`, `pulse`), then the variant's own surface; whichever wrote a property
 * last wins. The composition here spreads the SAME things in the SAME order, so
 * `glow` survives on a `default` paper (whose surface declares no shadow) and is
 * buried by a `glass` one, on both renderers.
 */

/** MUI's `palette.common.black`, which `UiTheme` has no slot for. */
const BLACK = '#000';

/** The named radius as a length. */
export function dialogRadius(theme: UiTheme, radius: DialogBorderRadius): number {
  return theme.spacing(DIALOG_RADIUS_UNITS[radius] ?? DIALOG_RADIUS_UNITS.lg);
}

/** The scrim behind the paper: half-black, or a fifth of it for `glass`. */
export function dialogBackdrop(glass: boolean): ViewStyle {
  return {
    backgroundColor: alpha(BLACK, glass ? DIALOG_BACKDROP.alpha.glass : DIALOG_BACKDROP.alpha.plain),
  };
}

const halo = (blurRadius: number, color: string): UiShadow[] => [
  { offsetX: 0, offsetY: 0, blurRadius, spreadDistance: 0, color },
];

/** The glass surface, shared by `variant="glass"` and the `glass` flag. */
function glassSurface(theme: UiTheme): ViewStyle {
  return {
    backgroundColor: alpha(theme.palette.background.paper, DIALOG_GLASS.backgroundAlpha),
    borderWidth: DIALOG_BORDER_WIDTH,
    borderStyle: 'solid',
    borderColor: alpha(theme.palette.primary.main, DIALOG_GLASS.borderAlpha),
  };
}

export interface DialogLookArgs {
  variant: DialogVariant;
  size: DialogSize;
  borderRadius: DialogBorderRadius;
  glass: boolean;
  glow: boolean;
  pulse: boolean;
}

export interface DialogLook {
  /** Where the paper sits inside the modal, and how far in from the edges. */
  overlay: ViewStyle;
  paper: ViewStyle;
  /** The paper's corner radius, for the pulse ring to follow. */
  radius: number;
}

/** The centred paper of `default` and `glass`, before the variant paints over it. */
function centredOverlay(theme: UiTheme): ViewStyle {
  return {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // The web gives the PAPER `margin: theme.spacing(2)`; an inset on the
    // overlay is the same gap and leaves the paper free to be `100%` wide.
    padding: theme.spacing(DIALOG_MARGIN_UNITS),
  };
}

function variantPaper(theme: UiTheme, a: DialogLookArgs, radius: number): ViewStyle {
  switch (a.variant) {
    case 'glass':
      return {
        ...glassSurface(theme),
        boxShadow: [
          {
            offsetX: 0,
            offsetY: DIALOG_GLASS.shadow.offsetY,
            blurRadius: DIALOG_GLASS.shadow.blurRadius,
            spreadDistance: 0,
            color: alpha(BLACK, DIALOG_GLASS.shadow.alpha),
          },
        ],
      };
    case 'fullscreen':
      return { borderRadius: 0, width: '100%', height: '100%', maxWidth: undefined };
    case 'drawer':
      return {
        // The web means `${radius}px 0 0 ${radius}px` here and builds it out of
        // `theme.spacing()`, which is already a px STRING — so the declaration
        // is invalid and the paper keeps MUI's own `shape.borderRadius`. Same
        // radius here, so the two renderers agree; see NATIVE-NOTES.md.
        borderRadius: theme.radius.md,
        width: DIALOG_MAX_WIDTH[a.size] ?? DIALOG_MAX_WIDTH.md,
        maxWidth: '100%',
        height: '100%',
        maxHeight: undefined,
      };
    default:
      return a.glass ? { ...glassSurface(theme), borderRadius: radius } : {};
  }
}

/** `fullscreen` and `drawer` fill the screen, so neither is inset or centred. */
function overlayFor(theme: UiTheme, variant: DialogVariant): ViewStyle {
  if (variant === 'fullscreen') return { flex: 1 };
  if (variant === 'drawer') return { flex: 1, alignItems: 'flex-end' };
  return centredOverlay(theme);
}

/**
 * Everything the dialog paints, decided once per render.
 *
 * The base carries what MUI's `Paper` gives every dialog — the paper colour and
 * `shadows[24]` — because React Native has no Paper to inherit them from; a
 * `glow` or a variant shadow then overrides it exactly as the `sx` does.
 */
export function dialogLook(theme: UiTheme, a: DialogLookArgs): DialogLook {
  const radius = dialogRadius(theme, a.borderRadius);

  const base: ViewStyle = {
    position: 'relative',
    borderRadius: radius,
    backgroundColor: theme.palette.background.paper,
    boxShadow: DIALOG_PAPER_SHADOW,
    width: '100%',
    maxWidth: DIALOG_MAX_WIDTH[a.size] ?? DIALOG_MAX_WIDTH.md,
    maxHeight: '100%',
    overflow: a.pulse ? 'visible' : 'hidden',
  };

  return {
    radius,
    overlay: overlayFor(theme, a.variant),
    paper: {
      ...base,
      ...(a.glow
        ? { boxShadow: halo(DIALOG_GLOW.blurRadius, alpha(theme.palette.primary.main, DIALOG_GLOW.alpha)) }
        : null),
      ...variantPaper(theme, a, radius),
    },
  };
}
