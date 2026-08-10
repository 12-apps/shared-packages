/**
 * The quick-pick column beside the calendar.
 *
 * These are BUTTONS, not links or list rows: each one sets the range and the
 * pressed one stays visibly pressed, which is what `aria-pressed` says out
 * loud. (A listbox with `aria-selected` would model it too — the rule is to
 * pick one and use it for every entry, so a reader's screen reader describes
 * the whole column the same way.)
 *
 * An over-cap entry is `aria-disabled` and keeps its place in the tab order,
 * with the reason rendered under the label. Removing it, or quietly shortening
 * the window it hands back, both answer "why can't I have this year?" with
 * silence.
 */
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import React, { useId } from 'react';

import type { ResolvedQuickRange } from './DateRangePicker.types';

const optionSx = (active: boolean, overMax: boolean): SxProps<Theme> => ({
  display: 'block',
  // Full-width rows in the side column; chips that flow onto as many lines as
  // they need once the column has become a row under the calendar. A fixed
  // full width in both would make the narrow layout nine stacked lines.
  width: { xs: 'auto', md: '100%' },
  textAlign: 'left',
  font: 'inherit',
  fontSize: '0.875rem',
  fontWeight: active ? 600 : 400,
  lineHeight: 1.4,
  px: 1.5,
  py: 0.75,
  border: '1px solid',
  borderColor: active ? 'primary.main' : 'transparent',
  borderRadius: 1,
  cursor: overMax ? 'not-allowed' : 'pointer',
  color: overMax ? 'text.disabled' : active ? 'primary.main' : 'text.primary',
  backgroundColor: active ? 'action.selected' : 'transparent',
  '&:hover': { backgroundColor: overMax ? 'transparent' : 'action.hover' },
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
});

const REASON_SX: SxProps<Theme> = {
  display: 'block',
  fontSize: '0.6875rem',
  lineHeight: 1.3,
  mt: 0.25,
  color: 'text.disabled',
};

export interface DateRangeQuickListProps {
  options: ResolvedQuickRange[];
  /** The entry the current draft equals, if any. */
  activeId: string | undefined;
  onPick: (option: ResolvedQuickRange) => void;
  /** Why an entry is refused, rendered under it. */
  reasonFor: (option: ResolvedQuickRange) => string;
  /** Accessible name of the group. */
  label: string;
  dataTestId: string;
}

export function DateRangeQuickList({
  options,
  activeId,
  onPick,
  reasonFor,
  label,
  dataTestId,
}: DateRangeQuickListProps): React.JSX.Element {
  const reasonPrefix = useId();

  return (
    <Box
      role="group"
      aria-label={label}
      data-testid={`${dataTestId}-quick-list`}
      sx={{
        display: 'flex',
        // A column beside the calendar; a wrapping row above it once there is
        // no width for both. Checked at 390px: the calendar keeps its full
        // 280px grid and the entries flow onto as many lines as they need.
        flexDirection: { xs: 'row', md: 'column' },
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        gap: 0.5,
        minWidth: { md: 168 },
        maxWidth: { md: 200 },
      }}
    >
      {options.map((option) => {
        const active = option.id === activeId;
        const reasonId = `${reasonPrefix}-${option.id}`;
        return (
          <Box
            component="button"
            type="button"
            key={option.id}
            aria-pressed={active}
            // `aria-disabled`, never the `disabled` attribute: a disabled button
            // is skipped by the tab order, so the reason under it is unreachable
            // by exactly the reader most likely to need it.
            aria-disabled={option.overMax || undefined}
            aria-describedby={option.overMax ? reasonId : undefined}
            data-testid={`${dataTestId}-quick-${option.id}`}
            onClick={() => {
              if (!option.overMax) onPick(option);
            }}
            sx={optionSx(active, option.overMax)}
          >
            {option.label}
            {option.overMax && (
              <Box component="span" id={reasonId} sx={REASON_SX}>
                {reasonFor(option)}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
