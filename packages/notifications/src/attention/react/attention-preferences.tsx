/**
 * The device's settings for the attention button — sound, vibration,
 * notifications and where the button sits — in two sizes:
 *
 * - `AttentionPreferencesPanel`: the full section for the host's user
 *   settings: each channel's heading, a sentence, its levels with a hint each,
 *   and a test; sections parted by a rule.
 * - `AttentionQuickSettings`: one small round button for a sheet's header,
 *   opening the same three choices in a popover, headings short and no hints.
 *
 * One store behind both, so a change in either is the other's too.
 */
import { useState, type JSX, type MouseEvent, type ReactNode } from 'react';

import { Popover } from '@12-apps/ui/data-display/Popover';
import { Button } from '@12-apps/ui/form/Button';
import { RadioGroup } from '@12-apps/ui/form/RadioGroup';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { AttentionChannelLevel } from '../core';

import { playAttentionSound, useCanVibrate, vibrateFor, type AttentionSounds } from './alerts';
import type { AttentionChannelMessages, AttentionPreferencesMessages } from './messages';
import {
  useAttentionPreferences,
  type AttentionPreferences,
  type AttentionPreferencesStore,
} from './preferences';

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

function Choices({ channel, words, value, onChange, disabled, compact }: ChoicesProps): JSX.Element {
  return (
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
}

function Hint({
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

function Action({
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

/** One section of the panel: the heading, its sentence, then whatever it holds. */
function Section({
  title,
  description,
  first = false,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly first?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Box
      component="section"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        ...(first ? {} : { borderTop: 1, borderColor: 'divider', pt: 1.75 }),
      }}
    >
      <Text variant="body" weight="bold" as="h3">
        {title}
      </Text>
      <Hint>{description}</Hint>
      {children}
    </Box>
  );
}

interface PanelParts {
  readonly store: AttentionPreferencesStore;
  readonly preferences: AttentionPreferences;
  readonly messages: AttentionPreferencesMessages;
}

function SoundSection({
  store,
  preferences,
  messages,
  sounds,
}: PanelParts & { readonly sounds?: AttentionSounds }): JSX.Element {
  const words = messages.sound;
  return (
    <Section title={words.title} description={words.description} first>
      <Choices
        channel="sound"
        words={words}
        value={preferences.sound}
        onChange={(sound) => store.write({ sound })}
        disabled={false}
        compact={false}
      />
      <Action onClick={() => playAttentionSound('late', sounds)}>{words.test}</Action>
    </Section>
  );
}

function VibrationSection({ store, preferences, messages }: PanelParts): JSX.Element {
  const words = messages.vibration;
  const vibrates = useCanVibrate();
  return (
    <Section title={words.title} description={words.description}>
      <Choices
        channel="vibration"
        words={words}
        value={vibrates ? preferences.vibration : 'off'}
        onChange={(vibration) => store.write({ vibration })}
        disabled={!vibrates}
        compact={false}
      />
      {vibrates ? (
        <Action onClick={() => vibrateFor('late')}>{words.test}</Action>
      ) : (
        <Hint tone="warning">{words.unavailable}</Hint>
      )}
    </Section>
  );
}

function PushSection({
  store,
  preferences,
  messages,
  push,
}: PanelParts & { readonly push: AttentionPushState }): JSX.Element {
  const words = messages.push;
  return (
    <Section title={words.title} description={words.description}>
      {!push.available && <Hint tone="warning">{words.unavailable}</Hint>}
      {push.available && !push.enabled && (
        <Action onClick={push.enable} solid>
          {words.enable}
        </Action>
      )}
      <Choices
        channel="push"
        words={words}
        value={push.enabled ? preferences.push : 'off'}
        onChange={(level) => store.write({ push: level })}
        disabled={!push.enabled}
        compact={false}
      />
      {push.enabled && push.test !== undefined && <Action onClick={push.test}>{words.test}</Action>}
    </Section>
  );
}

function PositionSection({ store, preferences, messages }: PanelParts): JSX.Element {
  const words = messages.position;
  const moved = preferences.dock !== null;
  return (
    <Section title={words.title} description={moved ? words.moved : words.resting}>
      {moved && <Action onClick={() => store.write({ dock: null })}>{words.reset}</Action>}
    </Section>
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
  const parts = { store, preferences, messages };
  return (
    <Box data-testid="attention-preferences" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <SoundSection {...parts} sounds={sounds} />
      <VibrationSection {...parts} />
      {push !== undefined && <PushSection {...parts} push={push} />}
      <PositionSection {...parts} />
    </Box>
  );
}

/** A bell with waves (something on) or struck through (everything off). */
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

function QuickGroup({
  title,
  first,
  children,
}: {
  readonly title: string;
  readonly first?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        ...(first ? {} : { borderTop: 1, borderColor: 'divider', pt: 1 }),
      }}
    >
      <Text variant="body" size="sm" weight="bold" as="span">
        {title}
      </Text>
      {children}
    </Box>
  );
}

function QuickChoices({
  store,
  preferences,
  messages,
  push,
}: PanelParts & { readonly push?: AttentionPushState }): JSX.Element {
  const vibrates = useCanVibrate();
  return (
    <Box
      role="group"
      aria-label={messages.quickLabel}
      sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, width: 250 }}
    >
      <QuickGroup title={messages.sound.shortTitle} first>
        <Choices
          channel="sound"
          words={messages.sound}
          value={preferences.sound}
          onChange={(sound) => store.write({ sound })}
          disabled={false}
          compact
        />
      </QuickGroup>
      <QuickGroup title={messages.vibration.shortTitle}>
        <Choices
          channel="vibration"
          words={messages.vibration}
          value={vibrates ? preferences.vibration : 'off'}
          onChange={(vibration) => store.write({ vibration })}
          disabled={!vibrates}
          compact
        />
        {!vibrates && <Hint>{messages.vibration.unavailableShort}</Hint>}
      </QuickGroup>
      {push !== undefined && (
        <QuickGroup title={messages.push.shortTitle}>
          {push.available && !push.enabled && (
            <Action onClick={push.enable} solid>
              {messages.push.enable}
            </Action>
          )}
          <Choices
            channel="push"
            words={messages.push}
            value={push.enabled ? preferences.push : 'off'}
            onChange={(level) => store.write({ push: level })}
            disabled={!push.enabled}
            compact
          />
        </QuickGroup>
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
