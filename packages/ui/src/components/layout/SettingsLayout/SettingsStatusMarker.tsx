'use client';

import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Box from '@mui/material/Box/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { SR_ONLY_SX, STATUS_COLOR } from './SettingsLayout.styles';
import type { SettingsNavItem, SettingsNavStatus } from './SettingsLayout.types';
import { blend, darken, getContrastRatio, lighten } from '../../../tokens/color';
import { rem, sxRem } from '../../../tokens/relative';
import { softSignal } from '../../../tokens/surfaces';

export interface SettingsStatusMarkerProps {
  /** Which situation to draw. */
  status: SettingsNavStatus;
  /** What it means, in the host's language — the only carrier a screen reader gets. */
  label?: string;
  /** `data-testid` for the marker element. */
  testId?: string;
}

/**
 * Each situation's mark, by SHAPE as well as colour.
 *
 * - `ok`, `off` — a filled 8px dot (green, grey).
 * - `new` — a hollow ring in the primary colour. Never opened is not a fault:
 *   it was a red dot until a rail of ten unvisited sections read as ten
 *   failures, and drowned the one row that did need action.
 * - `attention` — a filled 10px dot in `warning.main`, larger than the others,
 *   and drawn beside its visible word ({@link SettingsStatusWord}).
 *
 * A ring, a small dot and a larger dot stay apart for a reader who cannot tell
 * the colours apart, which is what "colour is never the only signal" asks.
 */
function markShape(status: Exclude<SettingsNavStatus, 'locked'>): Record<string, unknown> {
  if (status === 'new') {
    return {
      width: sxRem(9),
      height: sxRem(9),
      boxSizing: 'border-box',
      borderStyle: 'solid',
      borderWidth: sxRem(2),
      borderColor: STATUS_COLOR.new,
      bgcolor: 'transparent',
    };
  }
  const size = status === 'attention' ? 10 : 8;
  return { width: sxRem(size), height: sxRem(size), bgcolor: STATUS_COLOR[status] };
}

/**
 * The visible word an item carries beside its marker, or `undefined` for none.
 *
 * Only `attention` draws one. The other situations are background information
 * a rail repeats on most rows, and a word on each of them would be the noise
 * the attention word exists to stand out from.
 */
export function visibleStatusWord(
  item: Pick<SettingsNavItem, 'status' | 'statusText'>,
): string | undefined {
  if (item.status !== 'attention') return undefined;
  const word = item.statusText?.trim();
  return word ? word : undefined;
}

/** The contrast WCAG asks of 13px text. */
export const STATUS_WORD_MIN_CONTRAST = 4.5;

/**
 * The surfaces the word can sit on: the panel, the attention chip's soft
 * warning fill, and the selected row's primary wash, each as one opaque colour.
 */
export function statusWordSurfaces(theme: Theme): string[] {
  const paper = theme.palette.background.paper;
  return [paper, softSignal(theme, 'warning'), blend(paper, theme.palette.primary.main, 0.18)];
}

/**
 * The word's ink: the darker step of `warning` on a light surface, the lighter
 * on a dark one, since `warning.main` itself is tuned to be a FILL. A theme
 * whose step still reads under 4.5:1 on any surface the word sits on (MUI's
 * default `warning.dark`, #e65100, is 3.79:1 on white) gets it moved towards
 * black, or white in dark mode, until it passes on all of them.
 */
export function statusWordColor(theme: Theme): string {
  const dark = theme.palette.mode === 'dark';
  const start = dark ? theme.palette.warning.light : theme.palette.warning.dark;
  try {
    const surfaces = statusWordSurfaces(theme);
    const passes = (ink: string): boolean =>
      surfaces.every((surface) => getContrastRatio(ink, surface) >= STATUS_WORD_MIN_CONTRAST);
    for (let step = 0; step <= 20; step += 1) {
      const ink = step === 0 ? start : dark ? lighten(start, step * 0.05) : darken(start, step * 0.05);
      if (passes(ink)) return ink;
    }
    return dark ? '#fff' : '#000';
  } catch {
    // A colour this cannot decompose (a CSS variable): trust the theme's step.
    return start;
  }
}

/**
 * The situation marker beside a settings entry: a dot, a ring, or a padlock
 * when the plan does not include the section.
 *
 * The label is rendered as visually-hidden text INSIDE the marker rather than as
 * an `aria-label` on it, so it lands in the accessible name of the row that
 * contains it. A row reading "Endereço, ligado" is one utterance; a decorative
 * dot with a title attribute beside it is two, and the second one is skipped.
 *
 * Colour alone never says which state this is — that is the whole reason
 * `label` exists, and why a marker without one is a marker with no meaning
 * attached.
 */
export function SettingsStatusMarker({
  status,
  label,
  testId,
}: SettingsStatusMarkerProps): React.JSX.Element {
  const hidden = label ? <Box component="span" sx={SR_ONLY_SX}>{label}</Box> : null;

  if (status === 'locked') {
    return (
      <Box
        component="span"
        data-testid={testId}
        data-status={status}
        sx={{ display: 'inline-flex', alignItems: 'center', color: 'text.disabled' }}
      >
        <LockOutlinedIcon sx={{ fontSize: sxRem(16) }} />
        {hidden}
      </Box>
    );
  }

  return (
    <Box
      component="span"
      data-testid={testId}
      data-status={status}
      sx={{ display: 'inline-flex', alignItems: 'center' }}
    >
      <Box
        component="span"
        data-status-mark=""
        sx={{ borderRadius: '50%', flex: '0 0 auto', ...markShape(status) }}
      />
      {hidden}
    </Box>
  );
}

SettingsStatusMarker.displayName = 'SettingsStatusMarker';

export interface SettingsStatusWordProps {
  /** The word, in the host's language. */
  text: string;
  /** `data-testid` for the word. */
  testId?: string;
  /** Lead the word with a middle dot, for a word that follows a label inline (the chip). */
  separated?: boolean;
}

/**
 * The short visible word an `attention` marker carries — "Pending".
 *
 * Hidden from assistive technology: the marker's own visually-hidden label
 * already says it (and says it in full), so a reader hears it once, not twice.
 * The middle dot is CSS, not text, for the same reason.
 */
export function SettingsStatusWord({
  text,
  testId,
  separated = false,
}: SettingsStatusWordProps): React.JSX.Element {
  return (
    <Box
      component="span"
      aria-hidden="true"
      data-testid={testId}
      sx={(theme) => ({
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        fontSize: rem(theme, 13),
        fontWeight: 700,
        color: statusWordColor(theme),
        ...(separated ? { '&::before': { content: '"·"', marginInlineEnd: rem(theme, 4) } } : null),
      })}
    >
      {text}
    </Box>
  );
}

SettingsStatusWord.displayName = 'SettingsStatusWord';
