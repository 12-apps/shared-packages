/**
 * The compact twin of `AttentionPreferencesPanel`: one small round button for
 * a sheet's header, opening the same choices in a popover — headings short,
 * no hints. One store behind both, so a change in either is the other's too.
 */
import { useState, type JSX, type MouseEvent, type ReactNode } from 'react';

import { Popover } from '@12-apps/ui/data-display/Popover';
import { Box } from '@12-apps/ui/mui/Box';

import { useCanVibrate } from './alerts';
import { FLOATING_MARGIN_PX, FLOATING_PAPER } from './floating';
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
      <Box component="strong" sx={{ fontSize: 13 }}>
        {title}
      </Box>
      {children}
    </Box>
  );
}

function QuickChoices({
  store,
  preferences,
  messages,
  push,
  maxHeight,
}: PanelParts & { readonly push?: AttentionPushState; readonly maxHeight?: number }): JSX.Element {
  const vibrates = useCanVibrate();
  return (
    <Box
      role="group"
      aria-label={messages.quickLabel}
      sx={{
        p: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        width: 'min(276px, calc(100vw - 24px))',
        boxSizing: 'border-box',
        ...(maxHeight === undefined ? {} : { maxHeight, overflowY: 'auto' }),
      }}
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
          {!push.available && <Hint>{messages.push.unavailable}</Hint>}
        </QuickGroup>
      )}
    </Box>
  );
}

/** The air between the bell and the choices it drops. */
const DROP_GAP_PX = 8;
/** Under this much room below the bell, the choices may rise as a popover does. */
const MIN_ROOM_PX = 200;

/**
 * Where the choices drop: under the bell, lined up with its right edge, and
 * no taller than the room left beneath it — so they scroll there rather than
 * rise over the bell and the header they belong to.
 */
function dropUnder(
  anchor: HTMLElement | null,
  rightEdge: ((anchor: HTMLElement) => number | null) | undefined,
): { readonly top: number; readonly left: number; readonly room: number | undefined } | null {
  if (anchor === null) return null;
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + DROP_GAP_PX;
  const room = window.innerHeight - top - FLOATING_MARGIN_PX;
  return { top, left: rightEdge?.(anchor) ?? rect.right, room: room >= MIN_ROOM_PX ? room : undefined };
}

export interface AttentionQuickSettingsProps {
  readonly store: AttentionPreferencesStore;
  readonly messages: AttentionPreferencesMessages;
  readonly push?: AttentionPushState;
  /**
   * The trigger's diameter in px — 44 by default, a full touch target; a host
   * sets its header's own icon size so the bell is its neighbours' twin.
   */
  readonly size?: number;
  /**
   * Where the choices' right edge lines up, in viewport px — the header's last
   * control, say, so they hang under the whole row of round buttons. Omitted,
   * the bell's own right edge.
   */
  readonly rightEdge?: (anchor: HTMLElement) => number | null;
}

export function AttentionQuickSettings({
  store,
  messages,
  push,
  size = 44,
  rightEdge,
}: AttentionQuickSettingsProps): JSX.Element {
  const preferences = useAttentionPreferences(store);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const on = anyOn(preferences, push, useCanVibrate());
  const drop = dropUnder(anchor, rightEdge);
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
        sx={{ ...TRIGGER_SX, width: size, height: size }}
      >
        <AlertsGlyph on={on} />
      </Box>
      <Popover
        open={drop !== null}
        anchorReference="anchorPosition"
        anchorPosition={drop === null ? undefined : { top: drop.top, left: drop.left }}
        onClose={() => setAnchor(null)}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        marginThreshold={FLOATING_MARGIN_PX}
        PaperProps={FLOATING_PAPER}
        dataTestId="attention-quick-settings-panel"
      >
        <QuickChoices
          store={store}
          preferences={preferences}
          messages={messages}
          push={push}
          maxHeight={drop?.room}
        />
      </Popover>
    </>
  );
}
