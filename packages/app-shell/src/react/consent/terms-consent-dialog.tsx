import { Suspense, lazy, useEffect, type JSX } from 'react';

import type { AppShellCopySource } from '../../core/copy';
import { stripTrailingSlashes } from '../../core/paths';
import {
  messagesOf,
  noLocale,
  type AppShellLocaleHook,
  type AppShellMessages,
} from '../messages';
import { useTermsConsent } from './use-terms-consent';

/**
 * The dialog itself, fetched the first time consent is actually stale.
 *
 * This component renders `null` on essentially every render, so `lazy`'s
 * fetch-on-first-render is exactly the trigger wanted: nothing is requested
 * until the gate has decided there is something to show. See
 * `terms-consent-surface.tsx` for what that saves every host.
 *
 * The fallback is `null` — the same nothing this component was already
 * rendering a moment earlier. A spinner would announce an interruption before
 * there is one to explain.
 */
const TermsConsentSurface = lazy(async () => ({
  default: (await import('./terms-consent-surface')).TermsConsentSurface,
}));

/**
 * The realtime accelerator's SEAM.
 *
 * Given a callback, register for "the terms situation may have changed" hints and
 * report whether the registration is currently live. A host implements it with one
 * line over its own event system:
 *
 *   useSignal: (onSignal) => events.useUserTopics({ topics: ['consent'], onMessage: onSignal })
 *
 * It is a hook rather than a subscribe function because a host's implementation IS a
 * hook, and it is CONFIG rather than a dependency because this package must not
 * carry a second copy of a realtime client — `@12-apps/realtime` already owns that
 * one. What stays here is the LOGIC of using it, below.
 */
export type ConsentSignalHook = (onSignal: () => void) => { connected: boolean };

/**
 * The realtime half of "tell them the moment it happens" — an accelerator on top of
 * {@link useTermsConsent}'s fetch, never a replacement for it (a best-effort bus is
 * best-effort by contract, so a prompt that existed only on the stream would miss
 * anyone whose connection dropped).
 *
 * Two things wake it, and BOTH matter. A terms-version bump ships as a DEPLOY — the
 * process restarts, every open stream drops, and the tab reconnects seconds later,
 * so re-asking on connect turns that restart into the notification. The other end is
 * acceptance, which the surface publishes through `consent.onAccepted`: accepting on
 * a phone clears this dialog on the laptop, where before it stayed up over a reason
 * that had already been resolved until someone reloaded.
 *
 * It re-ASKS rather than reading the event: what the server says is the only thing
 * that decides, exactly as it is on mount. Which is also why the seam is allowed to
 * be absent — a host with no event system simply gets the mount-time fetch, and
 * nothing here degrades quietly into claiming to be live.
 */
function useConsentStream(refresh: () => Promise<void>, useSignal?: ConsentSignalHook): void {
  // Hooks may not be called conditionally, so the no-op stands in for an absent
  // seam rather than the call site branching on it.
  const hook = useSignal ?? noSignal;
  const { connected } = hook(() => void refresh());
  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);
}

/** The "no event system wired" implementation: never connected, never a hint. */
const noSignal: ConsentSignalHook = () => ({ connected: false });

/**
 * Is the user currently READING one of the documents this dialog is about?
 *
 * The dialog is mounted app-wide and is `persistent`, so on the terms page it
 * covered the terms — asking someone to accept a document while sitting on top of
 * the document, with no way to move it. The two links are the only escape it offers,
 * and they led straight back under it.
 *
 * Suppressing it here loses nothing: these pages are read-only text, there is no
 * guarded action to dead-end on, and the prompt returns the moment the reader goes
 * anywhere else — including in the tab they came from, which the links leave
 * untouched because they open in a new one.
 */
function isReadingTheDocuments(hrefs: readonly string[]): boolean {
  if (typeof window === 'undefined') return false;
  // `stripTrailingSlashes`, not `replace(/\/+$/, '')`: the anchored form is quadratic
  // on a slash run with a non-slash tail, and `location.pathname` is attacker-supplied
  // — a link is enough to hand it one. See `../../core/paths.ts`.
  const path = stripTrailingSlashes(window.location.pathname);
  return hrefs.some((href) => {
    const target = stripTrailingSlashes(href.split(/[?#]/)[0] ?? '');
    return target !== '' && path === target;
  });
}

export interface TermsConsentDialogProps {
  /** Where the shell's surface is mounted. Defaults to `/api`. */
  apiBase?: string;
  termsHref?: string;
  privacyHref?: string;
  /** The nine sentences, or a resolver over a tag-keyed pack. */
  messages: AppShellCopySource<AppShellMessages>;
  useSignal?: ConsentSignalHook;
  /**
   * Which language to read them in. See {@link AppShellLocaleHook}.
   *
   * A hook, so the dialog re-renders when the reader changes it — a prop
   * carrying the resolved tag would freeze at whatever the parent last passed,
   * and the parent here is a factory-built component with no props at all.
   */
  useLocale?: AppShellLocaleHook;
}

/**
 * Ask for consent instead of dead-ending on it.
 *
 * Mounted app-wide, invisible until the user's acceptance is actually stale. Before
 * this, bumping the terms version left every previously-consented user signed in and
 * apparently fine right up to the payment step, where the checkout answered a raw
 * `Unauthorized` and offered a retry that could never work — the user had no way to
 * know what was wrong, and no way to fix it.
 *
 * `persistent` because it interrupts: there is nothing behind it the user can
 * usefully do, and dismissing it would only restore the silent dead end. But it is
 * not a trap — signing out remains available in the app behind it, and accepting
 * resumes whatever they were doing without a reload, since the guards read the
 * database rather than the session.
 */
export function TermsConsentDialog({
  apiBase,
  termsHref = '/terms',
  privacyHref = '/privacidade',
  messages: source,
  useSignal,
  useLocale,
}: TermsConsentDialogProps): JSX.Element | null {
  // Hooks may not be called conditionally, so an absent seam is stood in for by
  // a no-op rather than branched on at the call site — the same shape
  // `useConsentStream` uses one line down, and for the same rule.
  const locale = (useLocale ?? noLocale)();
  // Resolved HERE, in the render that shows the dialog. This component is
  // mounted app-wide and renders `null` on nearly every pass, so the language
  // is chosen at the one moment a reader is actually about to read it.
  const messages = messagesOf(source, locale);
  const { stale, accepting, accept, refresh } = useTermsConsent(
    apiBase === undefined ? {} : { apiBase },
  );

  useConsentStream(refresh, useSignal);

  if (!stale) return null;
  if (isReadingTheDocuments([termsHref, privacyHref])) return null;

  return (
    <Suspense fallback={null}>
      <TermsConsentSurface
        messages={messages}
        termsHref={termsHref}
        privacyHref={privacyHref}
        accepting={accepting}
        accept={() => void accept()}
      />
    </Suspense>
  );
}
