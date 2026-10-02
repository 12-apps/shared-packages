/**
 * The pieces the settings panel and the compact control share: a channel's
 * choices, a hint line and an action button — the design system's
 * `RadioGroup`, `Text` and `Button`, configured once.
 */
import type { JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { RadioGroup } from '@12-apps/ui/form/RadioGroup';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { AttentionChannelLevel } from '../core';

import type { AttentionChannelMessages } from './messages';

const LEVELS: readonly AttentionChannelLevel[] = ['off', 'late', 'all'];

/** What the host knows about push on this device. */
export interface AttentionPushState {
  /** The browser can receive push here at all (an iPhone needs the app on its Home Screen). */
  readonly available: boolean;
  /** This device is subscribed. */
  readonly enabled: boolean;
  /** Ask for permission and subscribe — from a tap, never on its own. */
  readonly enable: () => void;
  /** Send this device a test notification. */
  readonly test?: () => void;
}

type ChannelName = 'sound' | 'vibration' | 'push';

interface ChoicesProps {
  readonly channel: ChannelName;
  readonly words: AttentionChannelMessages;
  readonly value: AttentionChannelLevel;
  readonly onChange: (level: AttentionChannelLevel) => void;
  readonly disabled: boolean;
  readonly compact: boolean;
}

/**
 * The full panel's levels as the approved board draws them: each a tinted,
 * rounded tile, the hint tight under its label, both greyed when the device
 * cannot honour it. The compact popover keeps plain rows.
 */
const TILES_SX = {
  '& .MuiRadioGroup-root': { gap: 0.75 },
  '& .MuiFormControlLabel-root': {
    m: 0,
    px: 1,
    py: 0.75,
    borderRadius: 1,
    bgcolor: 'action.hover',
    alignItems: 'center',
  },
  '& .MuiFormControlLabel-label .MuiTypography-root': { display: 'block', lineHeight: 1.3 },
  '& .MuiFormControlLabel-root.Mui-disabled .MuiTypography-root': { color: 'text.disabled' },
} as const;

export function Choices({ channel, words, value, onChange, disabled, compact }: ChoicesProps): JSX.Element {
  const group = (
    <RadioGroup
      name={`attention-${compact ? 'quick-' : ''}${channel}`}
      aria-label={compact ? words.shortTitle : words.title}
      value={value}
      color="neutral"
      size={compact ? 'sm' : 'md'}
      showDescriptions={!compact}
      onChange={(event) => onChange(event.target.value as AttentionChannelLevel)}
      options={LEVELS.map((level) => ({
        value: level,
        label: words.levels[level],
        description: words.hints[level],
        disabled: disabled && level !== 'off',
      }))}
    />
  );
  return compact ? group : <Box sx={TILES_SX}>{group}</Box>;
}

export function Hint({
  children,
  tone = 'secondary',
}: {
  readonly children: string;
  readonly tone?: 'secondary' | 'warning';
}): JSX.Element {
  return (
    <Text variant="body" size="sm" color={tone}>
      {children}
    </Text>
  );
}

export function Action({
  children,
  onClick,
  solid = false,
}: {
  readonly children: string;
  readonly onClick: () => void;
  readonly solid?: boolean;
}): JSX.Element {
  return (
    <Box>
      <Button variant={solid ? 'solid' : 'outline'} color="neutral" size="sm" onClick={onClick}>
        {children}
      </Button>
    </Box>
  );
}
