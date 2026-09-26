import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React, { useId, useState } from 'react';

import { Icon } from '../../../icons';
import { rem } from '../../../tokens/relative';
import { Chip } from '../../data-display/Chip';
import { Button } from '../../form/Button';
import { BUTTON_SIZES } from '../../form/Button/Button.metrics';
import { Collapsible } from '../Collapsible';

import { SETTING_CARD } from './SettingCard.metrics';
import { errorStyles, headerStyles, iconStyles, titleStyles } from './SettingCard.styles';
import type { SettingHeadingLevel, SettingStatus } from './SettingCard.types';

/** `<root>-<part>` when the host gave a root test id, else nothing. */
export const partTestId = (root: string | undefined, part: string): string | undefined =>
  root ? `${root}-${part}` : undefined;

interface HeaderProps {
  titleId: string;
  title: string;
  headingLevel: SettingHeadingLevel;
  icon?: React.ReactNode;
  status?: SettingStatus;
  /** Rendered at the row's far end — the Edit trigger, or a switch. */
  trailing?: React.ReactNode;
  /** Renders the title as a `<label>` for this control instead of a heading. */
  labelFor?: string;
  dataTestId?: string;
}

/**
 * Icon, title, status pill, and whatever the row ends with.
 *
 * A switch card's title is the switch's `<label>`, so the words are both its
 * accessible name and a tap target far larger than the track. An editable
 * card's title is a heading, so the page outline lists every setting.
 */
export const SettingHeader: React.FC<HeaderProps> = ({
  titleId,
  title,
  headingLevel,
  icon,
  status,
  trailing,
  labelFor,
  dataTestId,
}) => {
  const theme = useTheme();
  return (
    <Box sx={headerStyles(theme)}>
      {icon && (
        <Box component="span" aria-hidden sx={iconStyles(theme)}>
          {icon}
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, minWidth: 0, flex: 1 }}>
        <Box
          component={labelFor ? 'label' : headingLevel}
          id={titleId}
          htmlFor={labelFor}
          sx={{ ...titleStyles(theme), ...(labelFor ? { cursor: 'pointer' } : {}) }}
          data-testid={partTestId(dataTestId, 'title')}
        >
          {title}
        </Box>
        {status && (
          <Chip
            label={status.label}
            color={status.color ?? 'neutral'}
            size="sm"
            variant="outlined"
            dataTestId={partTestId(dataTestId, 'status')}
          />
        )}
      </Box>
      {trailing}
    </Box>
  );
};

/**
 * The failure line. `role="alert"` so it is announced the moment it appears,
 * without anyone having to move focus to find it.
 */
export const SaveError: React.FC<{ id: string; message: string | null; dataTestId?: string }> = ({
  id,
  message,
  dataTestId,
}) => {
  const theme = useTheme();
  if (!message) return null;
  return (
    <Box component="p" id={id} role="alert" sx={errorStyles(theme)} data-testid={partTestId(dataTestId, 'error')}>
      {message}
    </Box>
  );
};

/** The spinner that rides beside a pending control; decorative — the words are announced separately. */
export const PendingSpinner: React.FC<{ dataTestId?: string }> = ({ dataTestId }) => {
  const theme = useTheme();
  return (
    <CircularProgress
      size={rem(theme, SETTING_CARD.spinnerSize)}
      color="inherit"
      aria-hidden
      data-testid={partTestId(dataTestId, 'saving')}
    />
  );
};

/**
 * The "learn more" disclosure: a text button that owns `aria-expanded`, and
 * the collapsible region it controls. Closed by default — it is the longer
 * explanation, and the form is what the reader came for.
 */
export const LearnMore: React.FC<{
  label: string;
  children: React.ReactNode;
  dataTestId?: string;
}> = ({ label, children, dataTestId }) => {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const theme = useTheme();
  return (
    // Pulled out by the button's own padding, so the words line up with the form above.
    <Box sx={{ marginLeft: `-${rem(theme, BUTTON_SIZES.sm.paddingHorizontal)}` }}>
      <Button
        variant="text"
        size="sm"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((was) => !was)}
        icon={
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: theme.transitions.create('transform'),
            }}
          >
            <Icon name="ExpandMore" size="xs" />
          </Box>
        }
        iconPosition="right"
        dataTestId={partTestId(dataTestId, 'learn-more')}
      >
        {label}
      </Button>
      {/* Kept mounted so `aria-controls` always names an element that exists. */}
      <Collapsible open={expanded} keepMounted sx={{ marginLeft: rem(theme, BUTTON_SIZES.sm.paddingHorizontal) }} dataTestId={partTestId(dataTestId, 'learn-more-content')}>
        <Box id={regionId} sx={{ ...theme.typography.body2, color: 'text.secondary', pt: 1 }}>
          {children}
        </Box>
      </Collapsible>
    </Box>
  );
};
