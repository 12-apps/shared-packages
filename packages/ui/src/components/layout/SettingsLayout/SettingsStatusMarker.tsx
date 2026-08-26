'use client';

import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Box from '@mui/material/Box/index.js';
import React from 'react';

import { SR_ONLY_SX, STATUS_COLOR } from './SettingsLayout.styles';
import type { SettingsNavStatus } from './SettingsLayout.types';

export interface SettingsStatusMarkerProps {
  /** Which situation to draw. */
  status: SettingsNavStatus;
  /** What it means, in the host's language — the only carrier a screen reader gets. */
  label?: string;
  /** `data-testid` for the marker element. */
  testId?: string;
}

/**
 * The situation marker beside a settings entry: a coloured dot, or a padlock
 * when the plan does not include the section.
 *
 * The label is rendered as visually-hidden text INSIDE the marker rather than as
 * an `aria-label` on it, so it lands in the accessible name of the row that
 * contains it. A row reading "Endereço, ligado" is one utterance; a decorative
 * dot with a title attribute beside it is two, and the second one is skipped.
 *
 * Colour alone never says which of the three states this is — that is the whole
 * reason `label` exists, and why a marker without one is a marker with no
 * meaning attached.
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
        <LockOutlinedIcon sx={{ fontSize: 16 }} />
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
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flex: '0 0 auto',
          bgcolor: STATUS_COLOR[status],
        }}
      />
      {hidden}
    </Box>
  );
}

SettingsStatusMarker.displayName = 'SettingsStatusMarker';
