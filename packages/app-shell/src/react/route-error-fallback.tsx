import type { JSX } from 'react';

import { ErrorState } from '@12-apps/ui/data-display/ErrorState';

import type { AppShellMessages } from './messages';

/**
 * What a crashed page looks like.
 *
 * Its own module so `route-error-boundary.ts` stays JSX-free and can be read as
 * the CONFIGURATION it is. `data-testid="route-error"` is part of the contract: the
 * e2e specs of every host that adopts this select on it, so renaming it is a
 * breaking change to those suites and not a cosmetic edit.
 *
 * The error's own `message` is shown rather than a generic apology, on purpose.
 * The message is usually the only actionable thing there is (a chunk name, a
 * failed field), and hiding it behind "algo deu errado" is how a support call
 * starts with nothing to go on.
 */
export function errorStateFallback({
  error,
  reload,
  messages,
}: {
  error: Error;
  reload: () => void;
  messages: AppShellMessages;
}): JSX.Element {
  return (
    <ErrorState
      title={messages.routeErrorTitle}
      message={error.message}
      retryLabel={messages.routeErrorRetry}
      onRetry={reload}
      dataTestId="route-error"
    />
  );
}
