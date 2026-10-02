/**
 * The compact twin of `AttentionPreferencesPanel`: one small round button for
 * a sheet's header, opening the same choices in a popover — headings short,
 * no hints. One store behind both, so a change in either is the other's too.
 */
import { useState, type JSX, type MouseEvent, type ReactNode } from 'react';

import { Popover } from '@12-apps/ui/data-display/Popover';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import { useCanVibrate } from './alerts';
import type { AttentionPreferencesMessages } from './messages';
import { Action, Choices, Hint, type AttentionPushState } from './preferences-parts';
import {
  useAttentionPreferences,
  type AttentionPreferences,
  type AttentionPreferencesStore,
} from './preferences';

interface PanelParts {
  readonly store: AttentionPreferencesStore;
  readonly preferences: AttentionPreferences;
  readonly messages: AttentionPreferencesMessages;
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
