/**
 * The per-BROWSER Web Push enable step, which sits above the preference matrix
 * because a preference alone cannot reach a device that never subscribed.
 */
import { useEffect, useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { NotificationMessages } from '../messages';

import type { NotificationsApiClient } from './api';
import { enableWebPush, getExistingPushSubscription } from './web-push-client';

/** The panel's copy for a host whose platform blocks browser-level push. */
export interface WebPushPlatformHint {
  title: string;
  body: string;
}

export interface WebPushSetupConfig {
  /**
   * The host's service-worker path. Path-routed SPAs each control their own
   * scope, and the file itself is the host's.
   */
  swPath?: string;
  /**
   * Whether THIS platform must be installed to the home screen before a
   * subscription can exist at all.
   *
   * iOS is the case: Safari has no browser-level Web Push, so "Ativar" there
   * asks no permission, creates no subscription, and fails with nothing a user
   * could act on. The check is a config seam rather than a dependency because
   * "is this an installable iOS browser" is a question a host's PWA layer
   * already answers (future-pay passes
   * `() => isIosInstallable() && !isStandalone()` from `@12-apps/pwa`).
   */
  needsInstallFirst?: () => boolean;
  /** What to say instead of the button when the check above is true. */
  installHint?: WebPushPlatformHint;
}

const cardSx = {
  p: 2,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 2,
} as const;

function InstallFirstHint({ hint }: { hint: WebPushPlatformHint }): JSX.Element {
  return (
    <Box sx={cardSx} data-testid="web-push-install-hint">
      <Text variant="body" size="sm" weight="semibold" as="p">
        {hint.title}
      </Text>
      <Text variant="caption" size="xs" color="secondary" as="p">
        {hint.body}
      </Text>
    </Box>
  );
}

type SetupState = 'idle' | 'checking' | 'on' | 'busy' | 'failed' | 'denied';

function statusText(state: SetupState, messages: NotificationMessages): string {
  if (state === 'on') return messages.devicePushOn;
  if (state === 'denied') return messages.devicePushDenied;
  if (state === 'failed') return messages.devicePushFailed;
  return messages.devicePushIdle;
}

export function WebPushDeviceSetup({
  available,
  api,
  messages,
  config,
}: {
  available: boolean;
  api: NotificationsApiClient;
  messages: NotificationMessages;
  config: WebPushSetupConfig;
}): JSX.Element | null {
  const [state, setState] = useState<SetupState>('checking');
  // Read once, at mount: neither can change without a new document.
  const [needsInstall] = useState(() => config.needsInstallFirst?.() ?? false);

  useEffect(() => {
    let cancelled = false;
    void getExistingPushSubscription().then((subscription) => {
      if (!cancelled) setState(subscription ? 'on' : 'idle');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;
  if (needsInstall && config.installHint) return <InstallFirstHint hint={config.installHint} />;

  const enable = async (): Promise<void> => {
    setState('busy');
    const result = await enableWebPush(api, config.swPath);
    if (result.ok) setState('on');
    else setState(result.reason === 'permission-denied' ? 'denied' : 'failed');
  };

  return (
    <Box
      sx={{
        ...cardSx,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
      }}
      data-testid="web-push-device-setup"
    >
      <Box sx={{ minWidth: 0 }}>
        <Text variant="body" size="sm" weight="semibold" as="p">
          {messages.devicePushTitle}
        </Text>
        <Text variant="caption" size="xs" color="secondary" as="p">
          {statusText(state, messages)}
        </Text>
      </Box>
      {state !== 'on' ? (
        <Button
          variant="outline"
          color="primary"
          size="sm"
          disabled={state === 'busy' || state === 'checking'}
          onClick={() => void enable()}
          dataTestId="web-push-enable"
        >
          {state === 'busy' ? messages.devicePushEnabling : messages.devicePushEnable}
        </Button>
      ) : null}
    </Box>
  );
}
