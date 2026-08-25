/**
 * What the consent gate puts on screen once it has something to say.
 *
 * Split from the gate so the SURFACE can be fetched at the moment it is needed.
 * `TermsConsentDialog` is mounted app-wide and returns `null` on essentially
 * every render — the terms version has not moved, or the user is on the terms
 * page reading them — but the `Dialog` it would eventually render was a static
 * import, so every host shipped MUI's `Dialog`, `Modal`, `Fade`, `Paper` and
 * focus trap in its ENTRY chunk to support a screen that appears when a legal
 * document changes.
 *
 * The gate keeps everything that decides: the consent hook, its poll, the
 * realtime accelerator and both guards. Only the rendering moved, so nothing
 * about WHEN the dialog appears depends on a chunk arriving.
 */
import type { JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Dialog, DialogActions, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { AppShellMessages } from '../messages';

export interface TermsConsentSurfaceProps {
  messages: AppShellMessages;
  termsHref: string;
  privacyHref: string;
  /** The accept call is in flight — the button holds its own spinner. */
  accepting: boolean;
  accept: () => void;
}

export function TermsConsentSurface({
  messages,
  termsHref,
  privacyHref,
  accepting,
  accept,
}: TermsConsentSurfaceProps): JSX.Element {
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
          onClick={accept}
          dataTestId="terms-consent-accept"
        >
          {messages.consentAccept}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
