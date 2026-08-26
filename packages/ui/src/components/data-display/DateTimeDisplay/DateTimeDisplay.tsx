import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { forwardRef } from 'react';

import { useDateTimeParts } from './DateTimeDisplay.hooks';
import type { DateTimeDisplayProps } from './DateTimeDisplay.types';
import type { SizeValue } from '../../../tokens/scales';

/**
 * Get font sizes based on size prop
 */
function getFontSizes(size: SizeValue) {
  switch (size) {
    case 'xs':
    case 'sm':
      return { date: '0.75rem', time: '0.65rem' };
    case 'lg':
    case 'xl':
      return { date: '1rem', time: '0.875rem' };
    case 'md':
    default:
      return { date: '0.875rem', time: '0.75rem' };
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
