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
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import React, { useId } from 'react';

import type { ResolvedQuickRange } from './DateRangePicker.types';

const optionSx = (active: boolean, overMax: boolean): SxProps<Theme> => ({
  display: 'block',
  // Full-width rows in the side column; pills in the narrow row. A fixed full
  // width in both would make the narrow layout nine stacked lines.
  width: { xs: 'auto', md: '100%' },
  // A pill must not be squeezed by its neighbours — the row SCROLLS rather
  // than compressing "Este trimestre" into two characters and an ellipsis.
  flex: { xs: '0 0 auto', md: '0 1 auto' },
  textAlign: 'left',
  font: 'inherit',
  fontSize: '0.875rem',
  fontWeight: active ? 600 : 400,
  lineHeight: 1.4,
  px: 1.5,
  py: 0.75,
  whiteSpace: { xs: 'nowrap', md: 'normal' },
  border: '1px solid',
  // Narrow, an entry has to look tappable on its own, with no column and no
  // rule to group it — so the pill carries a visible edge. Beside the calendar
  // the group already reads as a list and a border on every row would be nine
  // boxes where the selected one should be the only marked thing.
  borderColor: active ? 'primary.main' : { xs: 'divider', md: 'transparent' },
  borderRadius: { xs: 999, md: 1 },
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
        // A column beside the calendar; ONE scrolling row of pills above it
        // once there is no width for both.
        //
        // Scrolling rather than wrapping: nine wrapped pills take three or four
        // lines at 390px, which pushes the calendar most of a screen down and
        // makes the quick ranges — the fastest way to answer — the thing you
        // have to scroll past. One line keeps the calendar in view and costs a
        // horizontal swipe, which is the gesture a chip row already invites.
        flexDirection: { xs: 'row', md: 'column' },
        flexWrap: { xs: 'nowrap', md: 'wrap' },
        overflowX: { xs: 'auto', md: 'visible' },
        // Room for the focus ring, which an `overflow` container would clip.
        px: { xs: 0.25, md: 0 },
        py: { xs: 0.25, md: 0 },
        // The scrollbar is chrome on a phone and noise on a trackpad; the pills
        // themselves are the affordance, and the last one sits half-cut at the
        // edge to say the row continues.
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
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
