import type { JSX } from 'react';

import { ErrorState } from '@12-apps/ui/data-display/ErrorState';

import type { AppShellCopySource } from '../core/copy';

import {
  messagesOf,
  noLocale,
  type AppShellLocaleHook,
  type AppShellMessages,
} from './messages';

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
function errorStateFallback({
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

/**
 * The fallback as a COMPONENT, which is what lets its words follow the reader.
 *
 * `createRouteErrorBoundary` calls `fallback(...)` from inside a CLASS
 * component's `render`, so a hook called there would be a hook in a class —
 * illegal, and illegal in the quiet way: it only runs on the crash path, so a
 * suite that never crashes a page never finds out. Wrapping the fallback in a
 * function component gives the locale hook a render of its own, entered exactly
 * when the fallback is shown.
 *
 * That is also why the boundary is handed the copy SOURCE rather than resolved
 * words. The boundary is built once at module scope — it must be, or React
 * remounts the tree below it on every parent render — so anything resolved
 * there is resolved at import.
 */
export function ShellRouteErrorFallback({
  error,
  reload,
  messages: source,
  useLocale,
}: {
  error: Error;
  reload: () => void;
  messages: AppShellCopySource<AppShellMessages>;
  useLocale?: AppShellLocaleHook;
}): JSX.Element {
  // Hooks may not be called conditionally; the no-op stands in for an absent
  // seam. See `AppShellLocaleHook`.
  const locale = (useLocale ?? noLocale)();
  return errorStateFallback({ error, reload, messages: messagesOf(source, locale) });
}
