import type { CSSObject, SxProps, Theme } from '@mui/material/styles/index.js';

import { rem } from '../../../tokens/relative';
import { CARD_BORDER_WIDTH, CARD_RADIUS_UNITS } from '../Card/Card.metrics';

import { SETTING_CARD, SETTING_GROUP_INACTIVE_OPACITY } from './SettingCard.metrics';

/**
 * The attribute an open `SettingCard` carries, which `SettingGrid` reads to
 * give it the whole row. An attribute rather than a class so a host's wrapper
 * around the card can be matched with `:has()` as well.
 */
export const SETTING_CARD_OPEN_ATTR = 'data-setting-card-open';

/** `sx` as MUI documents it for composition: the component's own first, the caller's after. */
export const withCallerSx = (
  own: SxProps<Theme>,
  sx: SxProps<Theme> | undefined,
): SxProps<Theme> => [own, ...(Array.isArray(sx) ? sx : [sx])] as SxProps<Theme>;

/**
 * The card surface — `Card`'s outlined hairline and medium radius, so a
 * settings screen and a content screen are drawn with one kit.
 *
 * `height: 100%` is what turns the grid's per-row stretch into equal-height
 * cards: a grid item stretches, but a card that sized itself to its content
 * would not fill the item it sits in.
 *
 * `gridColumn: 1 / -1` while open is the full-row span. It lives on the card,
 * not only in the grid's CSS, so it also holds when the card sits in a host's
 * own grid. Outside a grid the property does nothing.
 */
export const surfaceStyles = (theme: Theme, open: boolean): CSSObject => ({
  boxSizing: 'border-box',
  height: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1.5),
  padding: theme.spacing(2.5),
  backgroundColor: theme.palette.background.paper,
  border: `${CARD_BORDER_WIDTH}px solid ${open ? theme.palette.primary.main : theme.palette.divider}`,
  borderRadius: theme.spacing(CARD_RADIUS_UNITS.lg),
  boxShadow: open ? theme.shadows[4] : 'none',
  transition: theme.transitions.create(['border-color', 'box-shadow'], {
    duration: theme.transitions.duration.short,
  }),
  ...(open ? { gridColumn: '1 / -1' } : {}),
});

/** A `row` toggle: the card's content with none of its surface. */
export const flatStyles = (theme: Theme): CSSObject => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.5),
  padding: theme.spacing(1.25, 0),
  minWidth: 0,
});

export const headerStyles = (theme: Theme): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: rem(theme, SETTING_CARD.iconGap),
  minWidth: 0,
});

/**
 * The title names its colour rather than inheriting it: a card rendered under
 * a theme other than the page's (a dark panel on a light page) would otherwise
 * take the page's text colour onto its own surface.
 */
export const titleStyles = (theme: Theme): CSSObject => ({
  ...theme.typography.subtitle1,
  fontWeight: theme.typography.fontWeightMedium,
  color: theme.palette.text.primary,
  margin: 0,
  minWidth: 0,
  overflowWrap: 'anywhere',
});

/** The one line a closed card shows. Long values end in an ellipsis, not a second line. */
export const summaryStyles = (theme: Theme): CSSObject => ({
  ...theme.typography.body2,
  color: theme.palette.text.secondary,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** A switch card's explanation, which may wrap: it is read, not scanned. */
export const descriptionStyles = (theme: Theme): CSSObject => ({
  ...theme.typography.body2,
  color: theme.palette.text.secondary,
  margin: 0,
});

/** The inactive group's hint: a glyph and the sentence, so it does not read as a second summary. */
export const hintStyles = (theme: Theme): CSSObject => ({
  ...descriptionStyles(theme),
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1),
  // Centre the 16px glyph on the first 20px line; later lines wrap under the text.
  '& > svg': { flexShrink: 0, marginTop: rem(theme, 2) },
});

export const errorStyles = (theme: Theme): CSSObject => ({
  ...theme.typography.body2,
  color: theme.palette.error.main,
  margin: 0,
});

export const actionsStyles = (theme: Theme): CSSObject => ({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: theme.spacing(1),
  marginTop: 'auto',
});

export const iconStyles = (theme: Theme): CSSObject => ({
  display: 'inline-flex',
  flexShrink: 0,
  color: theme.palette.text.secondary,
});

/**
 * A group's dependent rows: indented under the main switch, with a rule down
 * their left edge so the "belongs to" reads without words. While the main
 * switch is off they fade — and `inert` (set by the component) is what makes
 * them unreachable; opacity alone would only make them look it.
 */
export const dependentsStyles = (theme: Theme, active: boolean): CSSObject => ({
  display: 'flex',
  flexDirection: 'column',
  marginLeft: rem(theme, SETTING_CARD.groupIndent / 2),
  paddingLeft: rem(theme, SETTING_CARD.groupIndent / 2),
  borderLeft: `${rem(theme, SETTING_CARD.groupRuleWidth)} solid ${theme.palette.divider}`,
  opacity: active ? 1 : SETTING_GROUP_INACTIVE_OPACITY,
  transition: theme.transitions.create('opacity', { duration: theme.transitions.duration.short }),
});
