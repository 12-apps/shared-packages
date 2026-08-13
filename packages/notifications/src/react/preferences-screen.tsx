/**
 * The notification-preferences screen: the category × channel matrix over
 * `GET/PUT <mount>/notification-preferences`.
 *
 * Toggles auto-save (optimistic, per change); channels that cannot reach the
 * user right now (no phone on file / channel not declared) render disabled with
 * a hint. Web Push additionally carries the per-BROWSER enable step, since a
 * preference alone cannot reach a device that never subscribed.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';

import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Switch } from '@12-apps/ui/form/Switch';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { NotificationMessages } from '../messages';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '../types';

import type { NotificationsApiClient, PreferencesPayload } from './api';
import { WebPushDeviceSetup, type WebPushSetupConfig } from './web-push-setup';

type Availability = Record<NotificationChannel, boolean>;

/** One category's row of channel switches. */
function CategoryCard({
  category,
  channels,
  availability,
  messages,
  onToggle,
}: {
  category: string;
  channels: Record<NotificationChannel, boolean>;
  availability: Availability;
  messages: NotificationMessages;
  onToggle: (channel: NotificationChannel, enabled: boolean) => void;
}): JSX.Element {
  const labels = messages.categoryLabels[category];
  return (
    <Box
      sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
      data-testid={`prefs-${category}`}
    >
      <Text variant="body" size="sm" weight="semibold" as="p">
        {labels?.title ?? messages.categoryFallbackTitle(category)}
      </Text>
      {labels?.description ? (
        <Text variant="caption" size="xs" color="secondary" as="p">
          {labels.description}
        </Text>
      ) : null}
      <Box
        sx={{
          mt: 1.5,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
          gap: 1,
        }}
      >
        {NOTIFICATION_CHANNELS.map((channel) => (
          <Switch
            key={channel}
            size="sm"
            color="primary"
            label={messages.channelLabels[channel] ?? channel}
            // An unavailable channel reads OFF regardless of the stored choice:
            // a toggle that says "on" for a channel that cannot reach you is a
            // promise the pipeline will not keep.
            checked={channels[channel] && availability[channel]}
            disabled={!availability[channel]}
            onChange={(_, checked) => onToggle(channel, checked)}
            // `dataTestId`, not `data-testid`: the UI Switch puts this one on
            // the INPUT (and derives `-container` / `-label` from it), which is
            // the element a click and a `disabled` assertion need.
            dataTestId={`prefs-${category}-${channel}`}
          />
        ))}
      </Box>
    </Box>
  );
}

/** Why disabled toggles are disabled, one line per unavailable channel. */
function UnavailableHints({
  availability,
  messages,
}: {
  availability: Availability;
  messages: NotificationMessages;
}): JSX.Element | null {
  const unavailable = NOTIFICATION_CHANNELS.filter((channel) => !availability[channel]);
  if (unavailable.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {unavailable.map((channel) => (
        <Text
          key={channel}
          variant="caption"
          size="xs"
          color="secondary"
          as="p"
          data-testid={`prefs-hint-${channel}`}
        >
          {messages.channelLabels[channel] ?? channel}:{' '}
          {messages.channelUnavailableHints[channel] ?? ''}
        </Text>
      ))}
    </Box>
  );
}

export interface PreferencesScreenProps {
  /** Rendered under the lead paragraph — a "back to account" link, typically. */
  footer?: JSX.Element;
}

/** Optimistic per-toggle auto-save; a failed PUT takes the server's answer. */
function usePreferences(api: NotificationsApiClient): {
  payload: PreferencesPayload | null;
  toggle: (category: string, channel: NotificationChannel, enabled: boolean) => void;
} {
  const [payload, setPayload] = useState<PreferencesPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getPreferences()
      .then((next) => {
        if (!cancelled) setPayload(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  const toggle = useCallback(
    (category: string, channel: NotificationChannel, enabled: boolean) => {
      setPayload((current) => {
        const row = current?.preferences[category];
        if (!current || !row) return current;
        return {
          ...current,
          preferences: { ...current.preferences, [category]: { ...row, [channel]: enabled } },
        };
      });
      const reconcile = (): void => {
        void api.getPreferences().then(setPayload).catch(() => undefined);
      };
      void api
        .savePreference(category, channel, enabled)
        .then((result) => {
          // The PUT answers with the whole matrix, so a success REPLACES the
          // optimistic guess with the server's own row — which is what catches a
          // save the server merged differently from the way the screen assumed.
          if (result.ok) setPayload(result.data);
          else reconcile();
        })
        // The packaged transport never rejects (it folds a failure into
        // `ok: false`), but a HOST transport may — and an unhandled rejection
        // would leave the toggle showing a choice the server never took.
        .catch(reconcile);
    },
    [api],
  );

  return { payload, toggle };
}

export function PreferencesScreen({
  footer,
  api,
  messages,
  webPush,
}: PreferencesScreenProps & {
  api: NotificationsApiClient;
  messages: NotificationMessages;
  webPush: WebPushSetupConfig;
}): JSX.Element {
  const { payload, toggle } = usePreferences(api);

  if (!payload) {
    return (
      <LoadingState
        variant="spinner"
        message={messages.loadingMore}
        size="md"
        dataTestId="notification-prefs-loading"
      />
    );
  }

  const { preferences, availability, categories } = payload;
  return (
    <Box
      component="section"
      data-testid="notification-prefs-view"
      sx={{
        maxWidth: 640,
        mx: 'auto',
        width: '100%',
        px: 2,
        py: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box>
        <Text variant="heading" size="lg" as="h1">
          {messages.preferencesTitle}
        </Text>
        <Text variant="caption" size="sm" color="secondary" as="p">
          {messages.preferencesLead} {footer}
        </Text>
      </Box>
      <WebPushDeviceSetup
        available={availability.WEB_PUSH}
        api={api}
        messages={messages}
        config={webPush}
      />
      {categories.map((category) => (
        <CategoryCard
          key={category}
          category={category}
          channels={preferences[category] ?? {
            EMAIL: false,
            SMS: false,
            WHATSAPP: false,
            WEB_PUSH: false,
          }}
          availability={availability}
          messages={messages}
          onToggle={(channel, enabled) => toggle(category, channel, enabled)}
        />
      ))}
      <UnavailableHints availability={availability} messages={messages} />
    </Box>
  );
}
