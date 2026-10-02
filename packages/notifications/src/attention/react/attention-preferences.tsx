/**
 * The device's settings for the attention button — sound, vibration, push and
 * where the button sits — in two sizes:
 *
 * - `AttentionPreferencesPanel`: the full section for the host's user
 *   settings, each level with its hint, plus a test for sound and vibration.
 * - `AttentionQuickSettings`: one small round button for a sheet's header,
 *   opening the same three choices in a popover. One store behind both, so a
 *   change in either is the other's too.
 */
import { useState, type JSX, type MouseEvent } from 'react';

import { Popover } from '@12-apps/ui/data-display/Popover';
import { Button } from '@12-apps/ui/form/Button';
import { RadioGroup } from '@12-apps/ui/form/RadioGroup';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { AttentionChannelLevel } from '../core';

import { playAttentionSound, useCanVibrate, vibrateFor, type AttentionSounds } from './alerts';
import type { AttentionPreferencesMessages } from './messages';
import {
  useAttentionPreferences,
  type AttentionPreferences,
  type AttentionPreferencesStore,
} from './preferences';

const LEVELS: readonly AttentionChannelLevel[] = ['off', 'late', 'all'];

const SECTION_SX = { display: 'flex', flexDirection: 'column', gap: 1 } as const;

/** What the host knows about push on this device. */
export interface AttentionPushState {
  /** The browser can receive push here at all (an iPhone needs the app on its Home Screen). */
  readonly available: boolean;
  /** This device is subscribed. */
  readonly enabled: boolean;
  /** Ask for permission and subscribe — from a tap, never on its own. */
  readonly enable: () => void;
}

interface ChannelProps {
  readonly name: string;
  readonly label: string;
  readonly value: AttentionChannelLevel;
  readonly onChange: (level: AttentionChannelLevel) => void;
  readonly messages: AttentionPreferencesMessages;
  readonly disabled?: boolean;
  readonly compact?: boolean;
}

function Channel({
  name,
  label,
  value,
  onChange,
  messages,
  disabled = false,
  compact = false,
}: ChannelProps): JSX.Element {
  return (
    <RadioGroup
      name={name}
      label={label}
      value={value}
      size={compact ? 'sm' : 'md'}
      onChange={(event) => onChange(event.target.value as AttentionChannelLevel)}
      options={LEVELS.map((level) => ({
        value: level,
        label: messages.levels[level],
        description: compact ? undefined : messages.levelHints?.[level],
        disabled: disabled && level !== 'off',
      }))}
    />
  );
}

function Hint({ children }: { readonly children: string }): JSX.Element {
  return (
    <Text variant="body" size="sm" color="secondary">
      {children}
    </Text>
  );
}

function ActionButton({
  children,
  onClick,
  outline = true,
}: {
  readonly children: string;
  readonly onClick: () => void;
  readonly outline?: boolean;
}): JSX.Element {
  return (
    <Box>
      <Button variant={outline ? 'outline' : undefined} size="sm" onClick={onClick}>
        {children}
      </Button>
    </Box>
  );
}

interface SectionProps {
  readonly store: AttentionPreferencesStore;
  readonly preferences: AttentionPreferences;
  readonly messages: AttentionPreferencesMessages;
}

function SoundSection({
  store,
  preferences,
  messages,
  sounds,
}: SectionProps & { readonly sounds?: AttentionSounds }): JSX.Element {
  return (
    <Box sx={SECTION_SX}>
      <Channel
        name="attention-sound"
        label={messages.sound}
        value={preferences.sound}
        onChange={(sound) => store.write({ sound })}
        messages={messages}
      />
      <ActionButton onClick={() => playAttentionSound('late', sounds)}>{messages.testSound}</ActionButton>
    </Box>
  );
}

function VibrationSection({ store, preferences, messages }: SectionProps): JSX.Element {
  const vibrates = useCanVibrate();
  return (
    <Box sx={SECTION_SX}>
      <Channel
        name="attention-vibration"
        label={messages.vibration}
        value={vibrates ? preferences.vibration : 'off'}
        onChange={(vibration) => store.write({ vibration })}
        messages={messages}
        disabled={!vibrates}
      />
      {vibrates ? (
        <ActionButton onClick={() => vibrateFor('late')}>{messages.testVibration}</ActionButton>
      ) : (
        <Hint>{messages.vibrationUnavailable}</Hint>
      )}
    </Box>
  );
}

function PushSection({
  store,
  preferences,
  messages,
  push,
}: SectionProps & { readonly push: AttentionPushState }): JSX.Element {
  return (
    <Box sx={SECTION_SX}>
      {messages.pushHint !== undefined && <Hint>{messages.pushHint}</Hint>}
      {!push.available && <Hint>{messages.pushUnavailable}</Hint>}
      {push.available && !push.enabled && (
        <ActionButton onClick={push.enable} outline={false}>
          {messages.pushEnable}
        </ActionButton>
      )}
      <Channel
        name="attention-push"
        label={messages.push}
        value={push.enabled ? preferences.push : 'off'}
        onChange={(level) => store.write({ push: level })}
        messages={messages}
        disabled={!push.enabled}
      />
    </Box>
  );
}

function PositionSection({ store, preferences, messages }: SectionProps): JSX.Element {
  return (
    <Box sx={SECTION_SX}>
      <Text variant="body" weight="bold">
        {messages.position}
      </Text>
      <Hint>{preferences.dock === null ? messages.positionResting : messages.positionMoved}</Hint>
      {preferences.dock !== null && (
        <ActionButton onClick={() => store.write({ dock: null })}>{messages.resetPosition}</ActionButton>
      )}
    </Box>
  );
}

export interface AttentionPreferencesPanelProps {
  readonly store: AttentionPreferencesStore;
  readonly messages: AttentionPreferencesMessages;
  readonly push?: AttentionPushState;
  readonly sounds?: AttentionSounds;
}

export function AttentionPreferencesPanel({
  store,
  messages,
  push,
  sounds,
}: AttentionPreferencesPanelProps): JSX.Element {
  const preferences = useAttentionPreferences(store);
  const section = { store, preferences, messages };
  return (
    <Box data-testid="attention-preferences" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <SoundSection {...section} sounds={sounds} />
      <VibrationSection {...section} />
      {push !== undefined && <PushSection {...section} push={push} />}
      <PositionSection {...section} />
    </Box>
  );
}

/** A bell with waves (on) or struck through (everything off). */
function AlertsGlyph({ on }: { readonly on: boolean }): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 17V11a4 4 0 0 1 8 0v6l1.5 1.5h-11zM10.5 20.5h3" />
      {on ? (
        <path d="M4.5 8.5a6 6 0 0 0 0 6M2 6.5a9 9 0 0 0 0 10M19.5 8.5a6 6 0 0 1 0 6M22 6.5a9 9 0 0 1 0 10" />
      ) : (
        <path d="M4 4l16 16" />
      )}
    </svg>
  );
}

const TRIGGER_SX = {
  width: 44,
  height: 44,
  flexShrink: 0,
  borderRadius: '50%',
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  color: 'text.primary',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: 2 },
} as const;

/** Is any channel on, as far as this device can honour it? */
function anyOn(
  preferences: AttentionPreferences,
  push: AttentionPushState | undefined,
  canVibrate: boolean,
): boolean {
  const vibrates = canVibrate && preferences.vibration !== 'off';
  const pushes = push?.enabled === true && preferences.push !== 'off';
  return preferences.sound !== 'off' || vibrates || pushes;
}

function QuickChoices({
  store,
  preferences,
  messages,
  push,
}: SectionProps & { readonly push?: AttentionPushState }): JSX.Element {
  const vibrates = useCanVibrate();
  return (
    <Box
      role="group"
      aria-label={messages.title}
      sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 280 }}
    >
      <Channel
        name="attention-quick-sound"
        label={messages.sound}
        value={preferences.sound}
        onChange={(sound) => store.write({ sound })}
        messages={messages}
        compact
      />
      <Channel
        name="attention-quick-vibration"
        label={messages.vibration}
        value={vibrates ? preferences.vibration : 'off'}
        onChange={(vibration) => store.write({ vibration })}
        messages={messages}
        disabled={!vibrates}
        compact
      />
      {!vibrates && <Hint>{messages.vibrationUnavailable}</Hint>}
      {push !== undefined && (
        <Channel
          name="attention-quick-push"
          label={messages.push}
          value={push.enabled ? preferences.push : 'off'}
          onChange={(level) => store.write({ push: level })}
          messages={messages}
          disabled={!push.enabled}
          compact
        />
      )}
    </Box>
  );
}

export interface AttentionQuickSettingsProps {
  readonly store: AttentionPreferencesStore;
  readonly messages: AttentionPreferencesMessages;
  readonly push?: AttentionPushState;
}

export function AttentionQuickSettings({ store, messages, push }: AttentionQuickSettingsProps): JSX.Element {
  const preferences = useAttentionPreferences(store);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const on = anyOn(preferences, push, useCanVibrate());
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={messages.quickLabel}
        data-testid="attention-quick-settings"
        data-on={on}
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        sx={TRIGGER_SX}
      >
        <AlertsGlyph on={on} />
      </Box>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        dataTestId="attention-quick-settings-panel"
      >
        <QuickChoices store={store} preferences={preferences} messages={messages} push={push} />
      </Popover>
    </>
  );
}
