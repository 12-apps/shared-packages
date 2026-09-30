import type { JSX } from 'react';

import { ErrorState } from '@12-apps/ui/data-display/ErrorState';

import { isChunkLoadError, reloadOntoCurrentBuild } from '../core/chunk-recovery';
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
 *
 * ## Except when the page is simply from an older build
 *
 * A chunk that stopped existing at a deploy is not a bug the reader can report
 * or act on — "Failed to fetch dynamically imported module: /assets/menu-Ab12.js"
 * is noise to a shopper, and the reporter already has it. What IS actionable is
 * "there is a newer version, load it". So a stale chunk renders the host's
 * {@link AppShellMessages.routeUpdate} screen when the host wrote one, and its
 * button loads the page again past every cache ({@link reloadOntoCurrentBuild}),
 * not the plain reload the recovery already tried and the stale document won.
 *
 * A host that has not written `routeUpdate` keeps the generic screen with the
 * raw message, as before — only the button's reload changes for it.
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
  if (isChunkLoadError(error)) {
    const update = messages.routeUpdate;
    return (
      <ErrorState
        title={update?.title ?? messages.routeErrorTitle}
        message={update?.body ?? error.message}
        retryLabel={update?.retry ?? messages.routeErrorRetry}
        onRetry={reloadOntoCurrentBuild}
        // Not an error the reader caused or can fix beyond one tap — the amber
        // notice rather than the red failure, once the host has said so in words.
        severity={update ? 'warning' : 'error'}
        dataTestId="route-error"
      />
    );
  }
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
