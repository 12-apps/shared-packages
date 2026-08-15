import { useEffect, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Dialog, DialogActions, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { stripTrailingSlashes } from '../../core/paths';
import { messagesOf, type AppShellMessages } from '../messages';
import { useTermsConsent } from './use-terms-consent';

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
  messages: AppShellMessages;
  useSignal?: ConsentSignalHook;
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
  messages: override,
  useSignal,
}: TermsConsentDialogProps): JSX.Element | null {
  const messages = messagesOf(override);
  const { stale, accepting, accept, refresh } = useTermsConsent(
    apiBase === undefined ? {} : { apiBase },
  );

  useConsentStream(refresh, useSignal);

  if (!stale) return null;
  if (isReadingTheDocuments([termsHref, privacyHref])) return null;

  return (
    <Dialog
      open
      persistent
      showCloseButton={false}
      title={messages.consentTitle}
      data-testid="terms-consent-dialog"
    >
      <DialogContent>
        <Stack spacing={2}>
          <Text variant="body" size="sm">
            {messages.consentBody}
          </Text>
          {/*
            Named plainly. The whole failure this replaces was a user being stopped
            without being told why — repeating that here, with a vague "não foi
            possível continuar", would just move the dead end.
          */}
          <Alert
            variant="info"
            title={messages.consentWhyTitle}
            description={messages.consentWhyBody}
          />
          <Text variant="body" size="sm" color="secondary">
            <a href={termsHref} target="_blank" rel="noreferrer">
              {messages.consentTermsLink}
            </a>
            {' · '}
            <a href={privacyHref} target="_blank" rel="noreferrer">
              {messages.consentPrivacyLink}
            </a>
          </Text>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          variant="solid"
          color="primary"
          loading={accepting}
          disabled={accepting}
          onClick={() => void accept()}
          dataTestId="terms-consent-accept"
        >
          {messages.consentAccept}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
