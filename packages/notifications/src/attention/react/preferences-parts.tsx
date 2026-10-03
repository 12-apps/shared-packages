/**
 * The pieces the settings panel and the compact control share: a channel's
 * choices, a hint line and an action button — the design system's
 * `RadioGroup`, `Text` and `Button`, configured once.
 */
import type { JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { RadioGroup } from '@12-apps/ui/form/RadioGroup';
import { Box } from '@12-apps/ui/mui/Box';
import type { Theme } from '@12-apps/ui/mui/styles';

import type { AttentionChannelLevel } from '../core';

import { severityFill } from './attention-button';
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
  '& .MuiRadioGroup-root': { gap: 1 },
  '& .MuiFormControlLabel-root': {
    m: 0,
    minHeight: 48,
    px: 1,
    py: 0.5,
    borderRadius: 1,
    bgcolor: 'action.hover',
    alignItems: 'center',
  },
  '& .MuiFormControlLabel-label .MuiTypography-root': { display: 'block', lineHeight: 1.3, fontSize: 14 },
  '& .MuiFormControlLabel-label .MuiTypography-caption': { fontSize: 12, color: 'text.secondary' },
  '& .MuiRadio-root': { p: 0.5, mr: 0.5 },
  '& .MuiRadio-root .MuiSvgIcon-root': { fontSize: 18 },
  '& .MuiRadio-root.Mui-checked': { color: 'text.primary' },
  // The board fades the whole tile the device cannot honour, not just its words.
  '& .MuiFormControlLabel-root.Mui-disabled': { opacity: 0.45 },
  '& .MuiFormControlLabel-root.Mui-disabled .MuiTypography-root': { color: 'text.primary' },
} as const;

const TRACK_SX = {
  display: 'flex',
  p: '2px',
  gap: '2px',
  border: 1,
  borderColor: 'divider',
  borderRadius: 2,
} as const;

const SEGMENT_SX = {
  flex: 1,
  minWidth: 0,
  minHeight: 36,
  px: 0.5,
  border: 0,
  borderRadius: 1.5,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  cursor: 'pointer',
  bgcolor: 'transparent',
  color: 'text.primary',
  '&[aria-pressed="true"]': { bgcolor: 'text.primary', color: 'background.default' },
  '&:disabled': { cursor: 'default', color: 'text.disabled' },
  '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: 1 },
} as const;

/**
 * The compact control's levels: three segments on one line, the chosen one
 * inverted — a third of the height three stacked radios took in a popover.
 * A group of pressed/unpressed buttons, so each is announced with its state.
 */
function Segments({ channel, words, value, onChange, disabled }: Omit<ChoicesProps, 'compact'>): JSX.Element {
  const labels = words.shortLevels ?? words.levels;
  return (
    <Box role="group" aria-label={words.shortTitle} data-testid={`attention-quick-${channel}`} sx={TRACK_SX}>
      {LEVELS.map((level) => (
        <Box
          key={level}
          component="button"
          type="button"
          aria-pressed={value === level}
          aria-label={words.levels[level]}
          title={words.levels[level]}
          disabled={disabled && level !== 'off'}
          onClick={() => onChange(level)}
          sx={SEGMENT_SX}
        >
          {labels[level]}
        </Box>
      ))}
    </Box>
  );
}

export function Choices({ channel, words, value, onChange, disabled, compact }: ChoicesProps): JSX.Element {
  if (compact) {
    return <Segments channel={channel} words={words} value={value} onChange={onChange} disabled={disabled} />;
  }
  const group = (
    <RadioGroup
      name={`attention-${channel}`}
      aria-label={words.title}
      value={value}
      color="neutral"
      size="md"
      showDescriptions
      onChange={(event) => onChange(event.target.value as AttentionChannelLevel)}
      options={LEVELS.map((level) => ({
        value: level,
        label: words.levels[level],
        description: words.hints[level],
        disabled: disabled && level !== 'off',
      }))}
    />
  );
  return <Box sx={TILES_SX}>{group}</Box>;
}

export function Hint({
  children,
  tone = 'secondary',
}: {
  readonly children: string;
  readonly tone?: 'secondary' | 'warning';
}): JSX.Element {
  return (
    <Box
      component="p"
      sx={{
        m: 0,
        fontSize: 13,
        lineHeight: 1.4,
        // A warning in the darker amber the boards use for words, not the fill.
        color: (theme: Theme) =>
          tone === 'warning' ? severityFill(theme, 'spent') : theme.palette.text.secondary,
      }}
    >
      {children}
    </Box>
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
      <Button
        variant={solid ? 'solid' : 'outline'}
        color="neutral"
        size="sm"
        onClick={onClick}
        // The board's 44px controls: a full touch target on a phone.
        sx={{ minHeight: 44, ...(solid ? {} : { color: 'text.primary', borderColor: 'divider' }) }}
      >
        {children}
      </Button>
    </Box>
  );
}
