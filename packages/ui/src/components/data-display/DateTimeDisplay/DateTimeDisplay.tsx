import Box from '@mui/material/Box/index.js';
import Tooltip from '@mui/material/Tooltip/index.js';
import Typography from '@mui/material/Typography/index.js';
import { forwardRef } from 'react';

import { useDateTimeParts } from './DateTimeDisplay.hooks';
import type { DateTimeDisplayProps } from './DateTimeDisplay.types';
import { sxRem } from '../../../tokens/relative';
import type { SizeValue } from '../../../tokens/scales';

/**
 * Get font sizes based on size prop
 */
function getFontSizes(size: SizeValue) {
  switch (size) {
    case 'xs':
    case 'sm':
      return { date: sxRem(12), time: sxRem(10.4) };
    case 'lg':
    case 'xl':
      return { date: sxRem(16), time: sxRem(14) };
    case 'md':
    default:
      return { date: sxRem(14), time: sxRem(12) };
  }
}

interface StackedProps {
  formattedDate: string | null;
  formattedTime: string | null;
  fontSizes: ReturnType<typeof getFontSizes>;
  showTooltip: boolean;
  sx: DateTimeDisplayProps['sx'];
  dataTestId?: string;
}

const Stacked = forwardRef<HTMLSpanElement, StackedProps>(
  ({ formattedDate, formattedTime, fontSizes, showTooltip, sx, dataTestId }, ref) => (
    <Box
      component="span"
      ref={ref}
      data-testid={dataTestId}
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        lineHeight: 1.3,
        cursor: showTooltip ? 'help' : 'default',
        ...sx,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontWeight: 500,
          fontSize: fontSizes.date,
        }}
        data-testid={dataTestId ? `${dataTestId}-date` : undefined}
      >
        {formattedDate}
      </Typography>
      {formattedTime && (
        <Typography
          component="span"
          sx={{
            fontSize: fontSizes.time,
            color: 'text.secondary',
          }}
          data-testid={dataTestId ? `${dataTestId}-time` : undefined}
        >
          {formattedTime}
        </Typography>
      )}
    </Box>
  ),
);

Stacked.displayName = 'DateTimeDisplayStacked';

/**
 * DateTimeDisplay component - displays date and time in a stacked format
 * with date on one line and time on another.
 */
export const DateTimeDisplay = forwardRef<HTMLSpanElement, DateTimeDisplayProps>(
  (
    {
      date,
      dateFormat = 'short',
      timeFormat = '12h',
      showTimezone = false,
      size = 'md',
      showTooltip = true,
      tooltipContent,
      sx,
      dataTestId,
    },
    ref,
  ) => {
    const { dateObj, formattedDate, formattedTime, fullDateTime } = useDateTimeParts({
      date,
      dateFormat,
      timeFormat,
      showTimezone,
    });
    const fontSizes = getFontSizes(size);

    // Handle invalid or missing date
    if (!dateObj) {
      return (
        <Box
          component="span"
          ref={ref}
          data-testid={dataTestId}
          sx={{ color: 'text.disabled', ...sx }}
        >
          <Typography variant="caption">-</Typography>
        </Box>
      );
    }

    const content = (
      <Stacked
        ref={ref}
        formattedDate={formattedDate}
        formattedTime={formattedTime}
        fontSizes={fontSizes}
        showTooltip={showTooltip}
        sx={sx}
        dataTestId={dataTestId}
      />
    );

    if (!showTooltip) {
      return content;
    }

    return (
      <Tooltip
        title={tooltipContent || fullDateTime}
        arrow
        placement="top"
        slotProps={{
          tooltip: {
            sx: { px: 2, py: 1 },
          },
        }}
      >
        {content}
      </Tooltip>
    );
  },
);

DateTimeDisplay.displayName = 'DateTimeDisplay';
