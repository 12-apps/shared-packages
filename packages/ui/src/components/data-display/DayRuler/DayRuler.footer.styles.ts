import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { rem } from '../../../tokens/relative';
import { signalInk } from '../ScheduleGrid/schedule-tones';
import { DAY_RULER_METRICS as M } from './DayRuler.metrics';

/**
 * A marked footer's words (FUT-3882): the warning ink deepened until it reads
 * at 4.5:1 on the page — `warning.main` is 3.1:1 on white. The outline keeps
 * `warning.main`: a non-text mark needs 3:1.
 */
export function footerInk(theme: Theme, marked: boolean, plain: string): string {
  return marked ? signalInk(theme, 'warning', theme.palette.background.default) : plain;
}

/** A group's count line (FUT-3882): plain counts on the hours' columns, a marked hour outlined in the warning ink. */
export function footerCellSx(marked: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: rem(theme, M.coverage.font),
    borderRadius: rem(theme, M.coverage.radius),
    color: footerInk(theme, marked, theme.palette.text.primary),
    fontWeight: marked ? 500 : 400,
    // The hairline is always there, transparent when unmarked, so a mark never shifts a count.
    border: `1px solid ${marked ? theme.palette.warning.main : 'transparent'}`,
    minWidth: 0,
    overflow: 'hidden',
  });
}

/**
 * A footer line's sentence; when the host marks it ("Faltam 2, 20h–22h"), in
 * the readable warning ink with a warning bar before it — a shape, so colour
 * is never the only signal.
 */
export function footerNoteSx(marked: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    fontSize: rem(theme, M.meta),
    color: footerInk(theme, marked, theme.palette.text.secondary),
    fontWeight: marked ? 500 : 400,
    ...(marked ? { borderLeft: `${rem(theme, 3)} solid ${theme.palette.warning.main}`, paddingLeft: rem(theme, 6) } : {}),
  });
}

/** A group's trend line: as tall as the coverage row, drawn in the primary colour. */
export const trendSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'block',
  width: '100%',
  height: rem(theme, M.coverage.height + M.coverage.height / 2),
  color: theme.palette.primary.main,
  overflow: 'visible',
});
