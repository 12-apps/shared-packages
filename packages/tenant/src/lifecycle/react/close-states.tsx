/**
 * The close page's other states, and the reopen both it and the banner offer:
 * a tenant closing (since when, until when, the reopen), closed (one notice),
 * or neither open nor closing (it cannot be closed from here).
 */
import { useEffect, useRef, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Card, CardContent } from '@12-apps/ui/layout/Card';
import { Box } from '@12-apps/ui/mui/Box';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import { TOUCH } from './close-cards';
import { useClosingConfig } from './context';
import type { TenantLifecycleCopy } from './copy';
import type { TenantClosingView } from './types';

/** An ISO instant as the host's short day; nothing while there is none. */
export function useShortDay(): (iso: string | null) => string {
  const { shortDay } = useClosingConfig();
  return (iso) => (iso === null ? '' : shortDay(iso));
}

/**
 * Reopen, and once it went through say the status it answered: live again,
 * or back to the suspension it had (a reopen restores the status the close
 * started from, never assumes the live one).
 */
export function useReopenWithToast(slug: string, copy: TenantLifecycleCopy) {
  const config = useClosingConfig();
  const reopen = config.hooks.useReopen(slug);
  // On the write's own answer, not on this component's: the reopen takes the banner (or the card) away
  // with it, and the toast must still say what happened.
  const run = () => {
    reopen.mutateAsync().then(
      (answer) => {
        const live = answer.status === config.statuses.active;
        config.toast(live ? copy.reopened : copy.reopenedSuspended, {
          severity: 'success',
          testId: `${config.testIdWord}-reopened-toast`,
        });
      },
      // The refusal is the mutation's own error state, shown where the button is.
      () => undefined,
    );
  };
  return { isPending: reopen.isPending, isError: reopen.isError, error: reopen.error, run };
}

/** Neither open nor closing. Right after a reopen that restored a suspension, its title says so. */
export function NotClosableNotice({ copy, justReopened }: { copy: TenantLifecycleCopy; justReopened: boolean }): JSX.Element {
  // The reopen's button is gone with its card: focus lands on this notice, never on <body>.
  const notice = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (justReopened) notice.current?.focus();
  }, [justReopened]);
  return (
    <Box ref={notice} tabIndex={-1} sx={{ outline: 'none' }}>
      <Alert
        variant="info"
        title={justReopened ? copy.reopenedSuspended : copy.notClosableTitle}
        description={copy.notClosableBody}
        dataTestId="close-not-closable"
      />
    </Box>
  );
}

interface ClosingCardProps {
  view: TenantClosingView;
  slug: string;
  copy: TenantLifecycleCopy;
  /** The page saw the tenant open first: this is the close just confirmed, and focus lands here. */
  focusOnMount: boolean;
}

export function ClosingCard({ view, slug, copy, focusOnMount }: ClosingCardProps): JSX.Element {
  const { statuses } = useClosingConfig();
  const day = useShortDay();
  const reopen = useReopenWithToast(slug, copy);
  // After the close, the dialog and its opener are gone: focus lands on this card's heading, never on <body>.
  const heading = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);
  if (view.status === statuses.closed) {
    return <Alert variant="info" title={copy.closedTitle} description={copy.closedBody} dataTestId="close-closed" />;
  }
  return (
    <Card variant="outlined" data-testid="close-closing">
      <CardContent>
        <Box ref={heading} tabIndex={-1} sx={{ outline: 'none' }} data-testid="close-closing-heading">
          <Heading level="h3" size="h6">{copy.closingTitle}</Heading>
        </Box>
        <Box sx={{ mt: 1 }}><Text>{copy.closingBody(day(view.requestedAt), day(view.purgeAt))}</Text></Box>
        <Box sx={{ mt: 1 }}><Text color="secondary">{copy.reopenNote}</Text></Box>
        {reopen.isError ? (
          <Alert variant="danger" description={reopen.error?.message ?? ''} sx={{ mt: 1.5 }} dataTestId="close-reopen-error" />
        ) : null}
        <Button sx={{ mt: 2, ...TOUCH }} loading={reopen.isPending} onClick={reopen.run} dataTestId="close-reopen">
          {copy.reopen}
        </Button>
      </CardContent>
    </Card>
  );
}
