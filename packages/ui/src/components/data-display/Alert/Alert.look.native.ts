import type { TextStyle, ViewStyle } from 'react-native';

import type { AlertVariant } from './Alert.base';
import {
  ACTION_SLOT,
  ALERT_PADDING_UNITS,
  ALERT_RADIUS_UNITS,
  type AlertPalette,
  alertPalette,
  alertSurface,
  CLOSE_BUTTON,
  DESCRIPTION,
  GLOW,
  ICON_SLOT,
  MESSAGE_FONT_SIZE,
  MESSAGE_GAP_UNITS,
  MESSAGE_LINE_HEIGHT,
  TITLE,
} from './Alert.metrics';
import { alpha } from '../../../tokens/color';
import { muiTypeStyle } from '../../../tokens/mui-type';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * THE PAINT, KEPT APART FROM THE STRUCTURE.
 *
 * `Alert.native.tsx` reads as what renders where; this file reads as
 * arithmetic — the same palette slots, alphas and px the web's
 * `Alert.styles.tsx` derives from `Alert.metrics.ts`.
 */

export interface AlertLookArgs {
  variant: AlertVariant;
  color: ColorValue | undefined;
  glow: boolean;
  pulse: boolean;
}

export interface AlertLook {
  palette: AlertPalette;
  /** What the words are set in. */
  ink: string;
  iconColor: string;
  root: ViewStyle;
}

/**
 * The root's paint. The web keeps `overflow: hidden` (its pulse wash is
 * clipped to the card, as it is here); only the glow opens it, because a
 * view's own shadow is clipped by its own overflow on a device.
 */
export function alertLook(theme: UiTheme, a: AlertLookArgs): AlertLook {
  const palette = alertPalette(theme, a.color ?? a.variant);
  const surface = alertSurface(theme, a.variant, palette);
  const root: ViewStyle = {
    flexDirection: 'row',
    paddingVertical: theme.spacing(ALERT_PADDING_UNITS.vertical),
    paddingHorizontal: theme.spacing(ALERT_PADDING_UNITS.horizontal),
    borderRadius: theme.spacing(ALERT_RADIUS_UNITS),
    overflow: a.glow ? 'visible' : 'hidden',
    backgroundColor: surface.backgroundColor,
    ...(surface.borderColor ? { borderWidth: 1, borderColor: surface.borderColor } : {}),
    ...(a.glow
      ? {
          boxShadow: `0 0 ${GLOW.blur}px ${GLOW.spread}px ${alpha(palette.main, GLOW.alpha)}`,
          filter: `brightness(${GLOW.brightness})`,
        }
      : {}),
  };
  return { palette, ink: surface.color, iconColor: surface.iconColor, root };
}

/** The message column: 8px between its lines, allowed to shrink so long text wraps beside the icon. */
export const messageSlotStyle = (theme: UiTheme): ViewStyle => ({
  flexDirection: 'column',
  gap: theme.spacing(MESSAGE_GAP_UNITS),
  flexShrink: 1,
  minWidth: 0,
});

/** A string child: MUI's `body2` letter-spacing at 0.95rem on the message's 1.5. */
export const messageTextStyle = (theme: UiTheme, ink: string): TextStyle => ({
  ...muiTypeStyle(theme, 'body2', MESSAGE_FONT_SIZE),
  lineHeight: MESSAGE_FONT_SIZE * MESSAGE_LINE_HEIGHT,
  color: ink,
});

/** MUI's `AlertTitle` (a `body1` Typography) at 1.05rem and 600, lifted 2px, 4px above a description. */
export const titleStyle = (theme: UiTheme, ink: string, hasDescription: boolean): TextStyle => ({
  ...muiTypeStyle(theme, 'body1', TITLE.fontSize),
  fontWeight: `${TITLE.fontWeight}`,
  color: ink,
  marginTop: TITLE.marginTop,
  marginBottom: hasDescription ? theme.spacing(TITLE.marginBottomUnits) : 0,
});

/** The description: 0.925rem on the message's 1.5, faded to 0.9. */
export const descriptionStyle = (theme: UiTheme, ink: string): TextStyle => ({
  ...muiTypeStyle(theme, 'body2', DESCRIPTION.fontSize),
  lineHeight: DESCRIPTION.fontSize * MESSAGE_LINE_HEIGHT,
  color: ink,
  opacity: DESCRIPTION.opacity,
});

/** MUI's `.MuiAlert-icon` with the web's overrides: first-line aligned, 14px from the words, 2px down. */
export const iconSlotStyle = (theme: UiTheme): ViewStyle => ({
  alignSelf: 'flex-start',
  alignItems: 'center',
  marginRight: theme.spacing(ICON_SLOT.marginRightUnits),
  paddingTop: theme.spacing(ICON_SLOT.paddingTopUnits),
  paddingBottom: ICON_SLOT.paddingBottom,
  opacity: ICON_SLOT.opacity,
});

/** MUI's `.MuiAlert-action`: top-aligned, pushed to the right edge, 16px off the text. */
export const actionSlotStyle = (theme: UiTheme): ViewStyle => ({
  alignItems: 'flex-start',
  paddingTop: ACTION_SLOT.paddingTop,
  paddingLeft: theme.spacing(ACTION_SLOT.paddingLeftUnits),
  marginLeft: 'auto',
  marginRight: ACTION_SLOT.marginRight,
});

/** MUI's small `IconButton` at 0.7; pressed stands in for the web's hover (full opacity, a faint wash). */
export const closeButtonStyle = (theme: UiTheme, pressed: boolean): ViewStyle => ({
  padding: CLOSE_BUTTON.padding,
  borderRadius: theme.radius.full,
  opacity: pressed ? 1 : CLOSE_BUTTON.opacity,
  backgroundColor: pressed ? alpha(theme.palette.action.hover, CLOSE_BUTTON.washAlpha) : 'transparent',
});
