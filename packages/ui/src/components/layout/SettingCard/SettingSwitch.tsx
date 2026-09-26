import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React, { useId } from 'react';

import { Switch } from '../../form/Switch';
import { SR_ONLY_SX } from '../../form/Label/Label.styles';

import { useAsyncSwitch } from './SettingCard.hooks';
import { PendingSpinner, SaveError, SettingHeader, partTestId } from './SettingCard.parts';
import { descriptionStyles } from './SettingCard.styles';
import type { SettingToggleProps } from './SettingCard.types';

/** Everything the switch-driven cards share, minus the surface each draws around it. */
export type SettingSwitchBlockProps = Pick<
  SettingToggleProps,
  'title' | 'headingLevel' | 'icon' | 'summary' | 'checked' | 'onChange' | 'copy' | 'formatError' | 'dataTestId'
> & { disabled: boolean };

/** The ids one switch block wires its label, description and failure line with. */
export interface SettingSwitchIds {
  titleId: string;
  inputId: string;
  summaryId: string;
  errorId: string;
}

export const useSettingSwitchIds = (): SettingSwitchIds => {
  const base = useId();
  return {
    titleId: `${base}-title`,
    inputId: `${base}-switch`,
    summaryId: `${base}-summary`,
    errorId: `${base}-error`,
  };
};

/**
 * Title-as-label, the switch, its explanation and the failure line.
 *
 * The switch is never `disabled` while it saves, for the reason Save is not
 * (`SettingCard.tsx`): a disabled control drops keyboard focus. It says
 * `aria-busy` instead, ignores flips until the save settles (see
 * `useAsyncSwitch`), shows a spinner, and a polite live region says the words.
 */
export const SettingSwitchBlock: React.FC<
  SettingSwitchBlockProps & { ids: SettingSwitchIds; state: ReturnType<typeof useAsyncSwitch> }
> = ({ title, headingLevel = 'h3', icon, summary, copy, disabled, dataTestId, ids, state }) => {
  const theme = useTheme();
  const { shown, saving, error, flip } = state;
  const describedBy = [summary != null ? ids.summaryId : null, error ? ids.errorId : null]
    .filter(Boolean)
    .join(' ');

  const control = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
      {saving && <PendingSpinner dataTestId={dataTestId} />}
      <Switch
        id={ids.inputId}
        checked={shown}
        onChange={(event) => void flip(event.target.checked)}
        disabled={disabled}
        error={Boolean(error)}
        aria-describedby={describedBy || undefined}
        inputProps={{ role: 'switch', 'aria-busy': saving }}
        dataTestId={partTestId(dataTestId, 'switch')}
      />
    </Box>
  );

  return (
    <>
      <SettingHeader
        titleId={ids.titleId}
        title={title}
        headingLevel={headingLevel}
        icon={icon}
        labelFor={ids.inputId}
        trailing={control}
        dataTestId={dataTestId}
      />
      {summary != null && (
        <Box component="p" id={ids.summaryId} sx={descriptionStyles(theme)} data-testid={partTestId(dataTestId, 'summary')}>
          {summary}
        </Box>
      )}
      <SaveError id={ids.errorId} message={error} dataTestId={dataTestId} />
      <Box role="status" aria-live="polite" sx={SR_ONLY_SX}>
        {saving ? copy.saving : ''}
      </Box>
    </>
  );
};
