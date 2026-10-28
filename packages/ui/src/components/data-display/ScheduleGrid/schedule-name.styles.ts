import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { rem } from '../../../tokens/relative';
import { SCHEDULE_NAME_METRICS as M } from './ScheduleGrid.metrics';
import { signalInk } from './schedule-tones';

/**
 * THE PERSON'S NAME COLUMN, shared by the week grid and the day ruler
 * (FUT-3825): one look for the name, its adornment, its meta line and chips.
 * Each view passes its own type sizes; everything else is the same.
 */

/** The name as a button: it reads as text, underlines under the pointer. */
export const nameButtonSx: SxProps<Theme> = (theme: Theme) => ({
  font: 'inherit',
  background: 'transparent',
  border: 0,
  color: 'inherit',
  p: 0,
  textAlign: 'left',
  cursor: 'pointer',
  minHeight: rem(theme, M.button.minHeight),
  borderRadius: rem(theme, M.button.radius),
  position: 'relative',
  // A 40px hit area around the 24px name, the look unchanged (a phone's finger).
  '&::after': {
    content: '""',
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: rem(theme, M.button.hitArea),
    transform: 'translateY(-50%)',
  },
  '&:hover > span': { textDecoration: 'underline' },
  '&:focus-visible': {
    outline: `${rem(theme, M.ring)} solid ${theme.palette.primary.main}`,
    outlineOffset: rem(theme, M.button.ringOffset),
  },
});

/** At most two lines, the rest cut with an ellipsis (the whole text in `title`). */
const twoLines = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
} as const;

export function nameTextSx(size: number): SxProps<Theme> {
  return (theme: Theme) => ({ ...twoLines, fontSize: rem(theme, size), fontWeight: 500 });
}

/** The line under the name; `warning` in the signal's ink, readable on the page. */
export function metaSx(tone: 'default' | 'warning', size: number): SxProps<Theme> {
  return (theme: Theme) => ({
    ...twoLines,
    fontSize: rem(theme, size),
    mt: 0.25,
    color: tone === 'warning' ? signalInk(theme, 'warning', theme.palette.background.default) : theme.palette.text.secondary,
  });
}

/** The name and its adornment: one line while both fit, the adornment under the name when not. */
export const nameLineSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 0.75,
  rowGap: 0.25,
  minWidth: 0,
  '& > :first-of-type': { minWidth: 0 },
  '& > [data-schedule-adornment]': { flexShrink: 0, display: 'inline-flex' },
};

/** The host's chips under the meta: ONE line; a chip that does not fit shrinks and cuts its label. `top` in spacing units. */
export function chipsSx(top: number): SxProps<Theme> {
  return {
    display: 'flex',
    flexWrap: 'nowrap',
    gap: 0.75,
    mt: top,
    minWidth: 0,
    overflow: 'hidden',
    '& > *': { minWidth: 0, flexShrink: 1, maxWidth: '100%' },
  };
}
