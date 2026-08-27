'use client';

import { Box, Button, Stack, Typography } from '@mui/material';
import { useEffect, useState, type JSX } from 'react';

import { BTN_PRIMARY_SX, BTN_SECONDARY_SX, LINKISH_SX, T } from '../../components/panel-tokens';

import { useActivationCopy } from './copy-context';
import { Notice } from './notice';

/**
 * How long ago the provider was last asked, ticking.
 *
 * A second's resolution, from a value the POLL owns — not a counter this
 * component increments, which would drift away from the requests actually being
 * made and end up reassuring the owner about polling that had stopped.
 */
function useSecondsSince(timestamp: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Through the setter, never a closed-over binding — a counter that carried
    // its own previous value would keep counting after the poll stopped.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!timestamp) return null;
  return Math.max(0, Math.round((now - timestamp) / 1000));
}

/** "3s ago", or nothing at all before the first answer. */
function LastChecked({ lastCheckedAt }: { lastCheckedAt: number }): JSX.Element | null {
  const { awaiting } = useActivationCopy();
  const seconds = useSecondsSince(lastCheckedAt);
  if (seconds === null) return null;
  return (
    <Typography
      sx={{ fontSize: '11.5px', color: T.ink3 }}
      data-testid="verify-charge-last-checked"
    >
      {awaiting.lastChecked(seconds)}
    </Typography>
  );
}

/**
 * The return-trip variant. There is nothing to open and nothing to pay —
 * showing a pay button to someone who has just paid is how one owner,
 * reasonably reading it as "it did not work", paid four times.
 */
function ConfirmingReturn({
  lastCheckedAt,
  onCheckNow,
}: {
  lastCheckedAt: number;
  onCheckNow: () => Promise<void>;
}): JSX.Element {
  const { awaiting, actions } = useActivationCopy();
  return (
    <Stack spacing={1} data-testid="verify-charge-confirming">
      <Notice tone="info" title={awaiting.receivedTitle} description={awaiting.receivedBody} />
      <LastChecked lastCheckedAt={lastCheckedAt} />
      <Stack direction="row">
        <Button sx={LINKISH_SX} onClick={() => void onCheckNow()} data-testid="verify-charge-check-now">
          {actions.checkNow}
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * The payment link: opened, copied, or read — but no longer SHOUTED.
 *
 * It used to be printed in full underneath, and the reason was sound: a blocked
 * popup, a closed tab or a phone in the owner's hand all end at "I need the
 * address", and a button that only knows how to `window.open` serves none of
 * them. But a hosted-checkout URL can be ~400 characters of opaque blob, so the
 * longest thing on the screen was the one thing nobody reads — directly above
 * the sentence saying a payment was outstanding.
 *
 * So it is folded away rather than removed. Copy handles the ordinary case in
 * one click; "show the link" still yields a real, selectable anchor, which is
 * what a browser with no clipboard permission (and every non-secure origin has
 * none) falls back to. Dropping the address entirely would have re-created the
 * dead end with a tidier layout.
 */
function LinkActions({ checkoutUrl }: { checkoutUrl: string }): JSX.Element {
  const { awaiting } = useActivationCopy();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Button
          sx={BTN_PRIMARY_SX}
          onClick={() => window.open(checkoutUrl, '_blank', 'noopener')}
          data-testid="verify-charge-open-link"
        >
          {awaiting.openPaymentPage}
        </Button>
        <Button
          sx={BTN_SECONDARY_SX}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(checkoutUrl)
              .then(() => setCopied(true))
              // No clipboard permission: reveal the anchor instead, which is
              // the fallback that actually works on a non-secure origin.
              .catch(() => setShown(true));
          }}
          data-testid="verify-charge-copy-link"
        >
          {copied ? awaiting.linkCopied : awaiting.copyLink}
        </Button>
        <Button
          sx={LINKISH_SX}
          onClick={() => setShown((open) => !open)}
          data-testid="verify-charge-toggle-link"
        >
          {shown ? awaiting.hideLink : awaiting.showLink}
        </Button>
      </Stack>
      {shown ? (
        <Box
          component="a"
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="verify-charge-checkout-url"
          sx={{
            display: 'block',
            fontFamily: T.mono,
            fontSize: '12px',
            wordBreak: 'break-all',
            userSelect: 'text',
            color: T.ink2,
            p: '10px 12px',
            borderRadius: '8px',
            background: T.bg2,
            border: `1px solid ${T.line2}`,
          }}
        >
          {checkoutUrl}
        </Box>
      ) : null}
    </Stack>
  );
}

/**
 * A payment ATTEMPT was refused while this link stayed live.
 *
 * Rendered inside the waiting panel rather than replacing it, because the
 * charge is still there to be paid and the fix is another method on the SAME
 * link. Replacing the panel would take the link away and offer to generate a
 * second real charge for a first one nobody cancelled.
 */
function DeclinedNotice({ message }: { message: string }): JSX.Element {
  const { awaiting } = useActivationCopy();
  return (
    <Notice
      tone="warn"
      title={awaiting.declinedTitle}
      description={message}
      dataTestId="verify-charge-declined"
    />
  );
}

/**
 * The link is live and the owner is paying it on the provider's site (FUT-463).
 *
 * The tab was already opened for them, from inside the click that generated the
 * charge (see `useRedirectActivation`) — pressing the pay button IS the request
 * to go and pay, and making them hunt for a second button afterwards was the
 * extra step this screen exists to remove. So this panel is the fallback, and
 * it has to be a real one.
 *
 * "I already paid — check now" exists because the poll runs every few seconds
 * and someone who has just paid should not have to wonder whether the screen
 * noticed. It asks the provider, exactly as the timer does.
 */
export function AwaitingPayment({
  checkoutUrl,
  amountLabel,
  declined,
  lastCheckedAt,
  onCheckNow,
}: {
  /** Null on a return trip: the owner has PAID and we are only confirming. */
  checkoutUrl: string | null;
  amountLabel: string;
  /** A refused attempt on this still-payable charge, in the owner's language. */
  declined?: string;
  lastCheckedAt: number;
  onCheckNow: () => Promise<void>;
}): JSX.Element {
  const { awaiting, actions } = useActivationCopy();
  if (!checkoutUrl) {
    return <ConfirmingReturn lastCheckedAt={lastCheckedAt} onCheckNow={onCheckNow} />;
  }

  return (
    <Stack spacing={1} data-testid="verify-charge-awaiting">
      {declined ? <DeclinedNotice message={declined} /> : null}
      {/*
        The waiting title leads, because that is the screen's STATE and it is
        what the owner came back to check. The amount and the "we opened a tab"
        explanation are context for it; as the headline they described a thing
        that had already happened and left the owner to infer that the screen
        was still watching.
      */}
      <Notice
        tone="info"
        title={awaiting.waitingTitle}
        description={awaiting.waitingBody(amountLabel)}
      />
      <LinkActions checkoutUrl={checkoutUrl} />
      <Stack direction="row" spacing={1} alignItems="center">
        <LastChecked lastCheckedAt={lastCheckedAt} />
        <Button sx={LINKISH_SX} onClick={() => void onCheckNow()} data-testid="verify-charge-check-now">
          {actions.alreadyPaidCheckNow}
        </Button>
      </Stack>
    </Stack>
  );
}
