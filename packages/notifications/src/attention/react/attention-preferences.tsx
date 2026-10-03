/**
 * The device's settings for the attention button — sound, vibration,
 * notifications and where the button sits — as the full section of the host's
 * user settings: each channel's heading, a sentence, its levels with a hint
 * each, and a test; sections parted by a rule. The compact twin for a sheet's
 * header is `./attention-quick-settings.tsx`; one store behind both.
 */
import type { JSX, ReactNode } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

import { playAttentionSound, useCanVibrate, vibrateFor, type AttentionSounds } from './alerts';
import type { AttentionPreferencesMessages } from './messages';
import { Action, Choices, Hint, type AttentionPushState } from './preferences-parts';
import {
  useAttentionPreferences,
  type AttentionPreferences,
  type AttentionPreferencesStore,
} from './preferences';

export type { AttentionPushState } from './preferences-parts';

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
      <Box component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 700 }}>
        {title}
      </Box>
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
