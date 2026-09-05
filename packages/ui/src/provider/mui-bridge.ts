import type { PaletteColor, Theme, ThemeOptions } from '@mui/material/styles/index.js';

import { accentFor } from '../tokens/scales';
import {
  FONT_WEIGHTS,
  TYPE_SIZES,
  WEB_FONT_FAMILY,
  WEB_MONOSPACE_FONT_FAMILY,
  type UiHeadingStep,
  type UiPaletteColor,
  type UiTheme,
} from '../tokens/theme';
import { HEADING_LEVELS, headingMetrics, type HeadingLevel } from '../tokens/typography';

/**
 * THE TWO DIRECTIONS BETWEEN MUI'S THEME AND OURS. Web only.
 *
 * `uiThemeFromMui` is how a web component — or a shared style resolver such
 * as `box-layout.ts` — reads the host's MUI theme in the neutral shape the
 * native renderer reads natively. `muiThemeOptionsFrom` is the reverse, for
 * a host that has a `UiTheme` and no MUI theme yet: `UiProvider` on the web is
 * a MUI `ThemeProvider` fed by it.
 *
 * Both are field-by-field on purpose. A spread would carry MUI's extra keys
 * across and the native side would silently depend on one.
 */

const slot = (color: PaletteColor): UiPaletteColor => ({
  main: color.main,
  light: color.light,
  dark: color.dark,
  contrastText: color.contrastText,
});

const rem = (value: string | number | undefined, fallback: number): number => {
  if (typeof value === 'number') return value;
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return value.endsWith('rem') || value.endsWith('em') ? parsed * 16 : parsed;
};

const em = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

function headingSteps(theme: Theme): Record<HeadingLevel, UiHeadingStep> {
  return Object.fromEntries(
    HEADING_LEVELS.map((level) => {
      const metrics = headingMetrics(theme, level);
      return [
        level,
        {
          fontSize: rem(metrics.fontSize, 16),
          lineHeight: metrics.lineHeight,
          letterSpacing: em(metrics.letterSpacing),
          normalWeight: metrics.normalWeight,
        },
      ];
    }),
  ) as Record<HeadingLevel, UiHeadingStep>;
}

/** The host's MUI theme in the shape the native renderer reads. */
export function uiThemeFromMui(theme: Theme): UiTheme {
  const { palette } = theme;
  const unit = rem(theme.spacing(1), 8);
  const md = rem(theme.shape.borderRadius, 4);

  return {
    mode: palette.mode,
    palette: {
      mode: palette.mode,
      primary: slot(palette.primary),
      secondary: slot(palette.secondary),
      success: slot(palette.success),
      warning: slot(palette.warning),
      info: slot(palette.info),
      danger: slot(palette.error),
      neutral: accentFor(theme, 'neutral'),
      text: {
        primary: palette.text.primary,
        secondary: palette.text.secondary,
        disabled: palette.text.disabled,
      },
      background: { default: palette.background.default, paper: palette.background.paper },
      divider: palette.divider,
      action: {
        active: palette.action.active,
        hover: palette.action.hover,
        selected: palette.action.selected,
        disabled: palette.action.disabled,
        disabledBackground: palette.action.disabledBackground,
        focus: palette.action.focus,
      },
      grey: {
        50: palette.grey[50],
        100: palette.grey[100],
        200: palette.grey[200],
        300: palette.grey[300],
        400: palette.grey[400],
        500: palette.grey[500],
        600: palette.grey[600],
        700: palette.grey[700],
        800: palette.grey[800],
        900: palette.grey[900],
      },
    },
    spacing: (units: number) => units * unit,
    spacingUnit: unit,
    radius: { sm: md / 2, md, lg: md * 2, xl: md * 4, full: 9999 },
    typography: {
      fontFamily: theme.typography.fontFamily ?? WEB_FONT_FAMILY,
      monospaceFontFamily: WEB_MONOSPACE_FONT_FAMILY,
      sizes: TYPE_SIZES,
      weights: FONT_WEIGHTS,
      heading: headingSteps(theme),
    },
    zIndex: {
      appBar: theme.zIndex.appBar,
      drawer: theme.zIndex.drawer,
      modal: theme.zIndex.modal,
      snackbar: theme.zIndex.snackbar,
      tooltip: theme.zIndex.tooltip,
    },
  };
}

/** A `UiTheme` as the options MUI's `createTheme` builds the same palette from. */
export function muiThemeOptionsFrom(ui: UiTheme): ThemeOptions {
  const { palette } = ui;
  return {
    palette: {
      mode: palette.mode,
      primary: { ...palette.primary },
      secondary: { ...palette.secondary },
      success: { ...palette.success },
      warning: { ...palette.warning },
      info: { ...palette.info },
      error: { ...palette.danger },
      text: { ...palette.text },
      background: { ...palette.background },
      divider: palette.divider,
      action: { ...palette.action },
      grey: { ...palette.grey },
    },
    shape: { borderRadius: ui.radius.md },
    spacing: ui.spacingUnit,
    typography: { fontFamily: ui.typography.fontFamily ?? WEB_FONT_FAMILY },
    zIndex: { ...ui.zIndex },
  };
}
