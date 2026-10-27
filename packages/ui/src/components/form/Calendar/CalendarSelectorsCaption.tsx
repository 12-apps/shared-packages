import ArrowDropDown from '@mui/icons-material/ArrowDropDown';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import type { FC } from 'react';
import React from 'react';

import type { CalendarLabels } from '../../../copy/labels';
import { sxRem } from '../../../tokens/relative';

import type { CalendarView } from './Calendar.views';

/** Every control in the caption is a touch target at any width (44 design px). */
const TARGET_SIZE = sxRem(44);

const SelectorButton: FC<{
  testId: string;
  text: string;
  ariaLabel: string;
  expanded: boolean;
  controls: string;
  onClick: () => void;
}> = ({ testId, text, ariaLabel, expanded, controls, onClick }) => (
  <Button
    type="button"
    color="inherit"
    data-testid={testId}
    aria-label={ariaLabel}
    aria-expanded={expanded}
    aria-controls={expanded ? controls : undefined}
    endIcon={<ArrowDropDown />}
    onClick={onClick}
    sx={{
      minHeight: TARGET_SIZE,
      px: 1,
      whiteSpace: 'nowrap',
      textTransform: 'none',
      typography: 'subtitle1',
      fontWeight: 'bold',
      border: 1,
      borderColor: 'divider',
      backgroundColor: expanded ? 'action.selected' : 'transparent',
    }}
  >
    {text}
  </Button>
);

const ARROW_SX = { width: TARGET_SIZE, height: TARGET_SIZE } as const;

export interface CalendarSelectorsCaptionProps {
  monthText: string;
  year: number;
  view: CalendarView;
  labels: CalendarLabels;
  /** The id of the pick grid each button opens. */
  monthsId: string;
  yearsId: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onToggle: (view: Exclude<CalendarView, 'days'>) => void;
  /** Escape on a caption control closes an open grid; with none open it is the host's. */
  onEscape: () => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

/**
 * `<Month> ▾` and `<Year> ▾`, then the month arrows. Its keys are its own: the
 * container's day keys would otherwise turn Enter on a button into a day pick.
 * Escape is the exception while no grid is open, so the sheet or popover that
 * holds the calendar still closes on it.
 */
export const CalendarSelectorsCaption: FC<CalendarSelectorsCaptionProps> = ({
  monthText,
  year,
  view,
  labels,
  monthsId,
  yearsId,
  canGoPrevious,
  canGoNext,
  onToggle,
  onEscape,
  onPreviousMonth,
  onNextMonth,
}) => (
  <Box
    data-testid="calendar-header"
    onKeyDown={(event) => {
      if (event.key === 'Escape' && view === 'days') return;
      event.stopPropagation();
      if (event.key === 'Escape') onEscape();
    }}
    // Two groups that wrap rather than squeeze: in a 320 sheet the arrows take
    // a second line, and no button shrinks below a touch target.
    sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 2 }}
  >
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      <SelectorButton
        testId="calendar-month-select"
        text={monthText}
        ariaLabel={labels.chooseMonth(monthText)}
        expanded={view === 'months'}
        controls={monthsId}
        onClick={() => onToggle('months')}
      />
      <SelectorButton
        testId="calendar-year-select"
        text={String(year)}
        ariaLabel={labels.chooseYear(year)}
        expanded={view === 'years'}
        controls={yearsId}
        onClick={() => onToggle('years')}
      />
    </Box>

    <Box sx={{ display: 'flex', ml: 'auto' }}>
      <IconButton
        aria-label={labels.previousMonth}
        disabled={!canGoPrevious}
        onClick={onPreviousMonth}
        data-testid="calendar-prev-month"
        sx={ARROW_SX}
      >
        <ChevronLeft />
      </IconButton>
      <IconButton
        aria-label={labels.nextMonth}
        disabled={!canGoNext}
        onClick={onNextMonth}
        data-testid="calendar-next-month"
        sx={ARROW_SX}
      >
        <ChevronRight />
      </IconButton>
    </Box>
  </Box>
);
