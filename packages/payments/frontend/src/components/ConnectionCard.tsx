'use client';

import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';

import type { ConnectedOAuthAccount, PaymentEnvironment } from '@12-apps/payments-backend';

import { BTN_PRIMARY_SX, BTN_SECONDARY_SX, LINKISH_SX, T } from './panel-tokens';
import { usePaymentsSettingsCopy } from './settings-copy-context';

/**
 * The connect card's own pieces: what a connection IS, what authorizing
 * involves, and what removing it costs.
 *
 * Split from `ProviderConnection`, which is about the connection's STATE
 * MACHINE — one in-flight action, its failure, the grant's expiry. These four
 * are about what the owner reads while deciding, and keeping them here is what
 * holds both files inside the size gate.
 */

/**
 * What this connection IS, as four labelled facts.
 *
 * A connected store's screen used to answer "connected?" and stop. The
 * questions an owner actually returns with are which account, how it was
 * connected, which environment, and what it can take — and every one of them
 * was either absent or buried in a sentence. Read as a grid they are checkable
 * at a glance, which is the whole reason to come back to this screen at all.
 */
export function ConnectionFacts({
  environment,
  account,
  displayName,
}: {
  environment: PaymentEnvironment;
  account: ConnectedOAuthAccount | null;
  displayName: string;
}) {
  const copy = usePaymentsSettingsCopy().card;
  const env = usePaymentsSettingsCopy().environment;
  // A fact's testid names its VALUE, not its row: the environment is asserted
  // with an exact `toHaveText`, so hanging the id on the grid — or even on the
  // row, which also carries the "AMBIENTE" label — makes that assertion read
  // the whole card. Every consumer of this id wants the one string.
  const facts: { key: string; value: string; testId?: string }[] = [
    { key: copy.accountLabel, value: account?.accountLabel ?? account?.accountId ?? copy.accountHeading(displayName) },
    { key: copy.connectionLabel, value: copy.authorizedAt(displayName) },
    {
      key: copy.environmentLabel,
      value: environment === 'PRODUCTION' ? env.production : copy.sandboxWithNote,
      testId: 'payments-connected-environment',
    },
  ];
  if (account?.connectedAt) {
    facts.push({
      key: copy.connectedAtLabel,
      value: new Date(account.connectedAt).toLocaleString(),
    });
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: '12px 22px',
      }}
    >
      {facts.map(({ key, value, testId }) => (
        <Stack key={key} spacing={0.4} sx={{ borderLeft: `2px solid ${T.line2}`, pl: '11px' }}>
          <Typography
            sx={{
              fontSize: '11px',
              letterSpacing: '.05em',
              textTransform: 'uppercase',
              color: T.ink4,
              fontWeight: 700,
            }}
          >
            {key}
          </Typography>
          <Typography
            data-testid={testId}
            sx={{ fontSize: '13px', color: T.ink2, fontFamily: T.mono }}
          >
            {value}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/**
 * What authorizing actually involves, in three numbered steps.
 *
 * The card used to be one sentence and a button, which asks the owner to click
 * something that navigates away from their store to a site they will be asked
 * to log into. Numbering the three moments — sign in, authorize, come back —
 * makes the trip finite and says the one thing that most reduces hesitation:
 * you end up back here.
 */
export function ConnectSteps({ displayName }: { displayName: string }) {
  const copy = usePaymentsSettingsCopy().card;
  const steps = [
    copy.steps.signIn(displayName),
    copy.steps.authorize,
    copy.steps.comeBack,
  ];
  return (
    <Stack component="ol" spacing={1.1} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {steps.map((text, index) => (
        <Stack component="li" key={text} direction="row" gap="9px">
          <Box
            aria-hidden
            sx={{
              width: 19,
              height: 19,
              borderRadius: '50%',
              background: T.brandSoft,
              color: T.brandInk,
              fontSize: '11px',
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
              flex: '0 0 auto',
              mt: '1px',
            }}
          >
            {index + 1}
          </Box>
          <Typography sx={{ fontSize: '13px', color: T.ink2, lineHeight: 1.5 }}>{text}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * Confirmation for Desconectar, which is destructive and irreversible from
 * here: it revokes the grant at the provider, so the store stops being able to
 * charge immediately and getting back requires the owner to authorize again on
 * the provider's site. It also sat one careless click from "Reconectar".
 */
export function DisconnectDialog(props: {
  open: boolean;
  displayName: string;
  busy: boolean;
  /** The store is live on this provider — removing it stops checkout NOW. */
  receiving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** The softer path: keep the connection, stop taking orders through it. */
  onPauseInstead?: () => void;
}) {
  const copy = usePaymentsSettingsCopy().card;
  const { displayName, receiving } = props;
  return (
    <Dialog open={props.open} onClose={props.onCancel} data-testid="payments-disconnect-confirm">
      <DialogTitle sx={{ fontSize: '16.5px', fontWeight: 700, letterSpacing: '-.01em', pb: '8px' }}>
        {copy.removeQuestion(displayName)}
      </DialogTitle>
      <DialogContent sx={{ pb: '4px' }}>
        <DialogContentText sx={{ fontSize: '13px', color: T.ink2, lineHeight: 1.55 }}>
          {receiving
            ? copy.removeConsequenceLive
            : copy.removeConsequenceIdle}
        </DialogContentText>
        {/* The consequences, itemised. A single paragraph makes the reversible
            facts and the irreversible one weigh the same, and the one that
            costs money is the one an owner skims past. */}
        <Stack component="ul" spacing={1} sx={{ listStyle: 'none', m: 0, mt: '14px', p: 0 }}>
          {receiving ? (
            <Consequence tone="bad">{copy.removeStopsChargingNow}</Consequence>
          ) : null}
          <Consequence>
            {copy.removeRevokes(displayName)}
          </Consequence>
          <Consequence>
            {copy.removeKeepsSettled(displayName)}
          </Consequence>
          <Consequence>{copy.removeRestartsSetup}</Consequence>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ display: 'flex', flexDirection: 'column', gap: '8px', p: '18px 22px 20px' }}>
        {/* Offered FIRST, and only when it is a real alternative. An owner who
            came here to stop taking orders wants the switch, not the removal —
            and reaching for the destructive control is how they got here. */}
        {receiving && props.onPauseInstead ? (
          <Button
            fullWidth
            onClick={props.onPauseInstead}
            disabled={props.busy}
            sx={BTN_SECONDARY_SX}
            data-testid="payments-pause-instead"
          >
            {copy.pauseInstead}
          </Button>
        ) : null}
        <Button
          fullWidth
          variant="contained"
          disableElevation
          onClick={props.onConfirm}
          disabled={props.busy}
          data-testid="payments-disconnect-confirm-action"
          sx={{ ...BTN_PRIMARY_SX, background: T.bad, '&:hover': { background: '#a51f1f' } }}
        >
          {props.busy ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : copy.removeAction}
        </Button>
        <Button fullWidth onClick={props.onCancel} disabled={props.busy} sx={LINKISH_SX}>
          {copy.cancel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One consequence of removing the connection, marked by how much it costs. */
function Consequence({ children, tone }: { children: ReactNode; tone?: 'bad' }) {
  return (
    <Stack component="li" direction="row" gap="9px">
      <Box component="span" aria-hidden sx={{ fontWeight: 800, color: tone ? T.bad : T.ink4 }}>
        {tone ? '✕' : '·'}
      </Box>
      <Typography sx={{ fontSize: '12.5px', color: T.ink2, lineHeight: 1.5 }}>{children}</Typography>
    </Stack>
  );
}
