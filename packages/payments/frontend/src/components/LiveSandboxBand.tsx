'use client';

import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

import { BTN_PRIMARY_SX, CARD_INSET, T } from './panel-tokens';
import { sxRem } from './rem';
import type { LiveSandboxCopy } from './settings-copy';
import { usePaymentsSettingsCopy } from './settings-copy-context';
import { EN_US_PAYMENTS_SETTINGS_COPY } from './settings-en-US';

/**
 * What a provider's screen says when the deployment sells for real and this
 * connection is still in its provider's SIMULATED sandbox (FUT-4432): checkout
 * offers nothing from it, so the store is not taking money here even with the
 * switch on.
 *
 * Shown only when `sandboxRefused(config)` — the server's verdict — so nothing
 * here knows which providers simulate their sandbox or which deployment is live.
 */

/** The refused-sandbox sentences: the host's, else the English pack's (the `failures` precedent). */
export function useLiveSandboxCopy(): LiveSandboxCopy {
  return usePaymentsSettingsCopy().liveSandbox ?? EN_US_PAYMENTS_SETTINGS_COPY.liveSandbox!;
}

/** A warning triangle drawn inline — this package ships no icon set. Never the only signal. */
export function WarnIcon({ size = 14 }: { size?: number }) {
  return (
    <Box
      component="svg"
      aria-hidden="true"
      viewBox="0 0 24 24"
      sx={{ width: sxRem(size), height: sxRem(size), flex: '0 0 auto', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}
    >
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Box>
  );
}

/**
 * The full-bleed warning band under the card's header.
 *
 * The system's warning Alert in the environment band's geometry — square,
 * edge to edge, its text at the card's inset — because it is the same kind of
 * fact: a property of everything below it. `role="status"`, not MUI's default
 * `alert`: it is state on load, not news, and is read once.
 *
 * Its one button is the card's ONE primary and starts from the left at every
 * width (ADR 0184). Without `onAction` (no way to connect from here) the band
 * still says what is wrong and offers nothing to press; `disabled` is a role
 * that may not change settings, whose reason the host already prints above.
 */
export function LiveSandboxBand({
  nextInLine,
  onAction,
  disabled = false,
  busy = false,
  error = null,
}: {
  /** Another provider in the store's chain takes the money meanwhile. */
  nextInLine: boolean;
  onAction?: () => void;
  disabled?: boolean;
  /** The button's action is in flight: it takes no second tap. */
  busy?: boolean;
  /** Why that action failed, said where the owner pressed. */
  error?: string | null;
}) {
  const copy = useLiveSandboxCopy();
  return (
    <Alert
      severity="warning"
      variant="standard"
      square
      role="status"
      data-testid="payments-live-sandbox-band"
      sx={{
        mt: sxRem(12),
        // The body below sets no top inset of its own (ProviderCard), so the
        // band keeps the prototype's 16px from the first block under it.
        mb: sxRem(16),
        borderRadius: 0,
        px: CARD_INSET,
        py: sxRem(12),
        // `backgroundColor`, not `background`: a theme's standard-warning fill
        // is set on that property and would otherwise show through.
        '&&': { backgroundColor: T.warnSoft },
        borderTop: `1px solid ${T.warnLine}`,
        borderBottom: `1px solid ${T.warnLine}`,
        color: T.warnInk,
        // The icon sits on the FIRST line, as in the prototype, whatever the
        // theme says about centring an alert's icon against its whole message.
        alignItems: 'flex-start',
        '& .MuiAlert-icon': { color: T.warn, py: 0, mt: sxRem(-3.5), alignSelf: 'flex-start' },
        '& .MuiAlert-message': { py: 0, flex: (theme) => `1 1 ${theme.typography.pxToRem(300)}`, minWidth: 0 },
      }}
    >
      <Stack sx={{ gap: sxRem(12) }} alignItems="flex-start">
        <Typography sx={{ fontSize: sxRem(13.5), lineHeight: 1.5, color: T.warnInk }}>
          <strong>{copy.bandLead}</strong> {nextInLine ? copy.bandNextInLine : copy.bandNobodyPays}
        </Typography>
        {onAction ? (
          <Button
            variant="contained"
            disableElevation
            disabled={disabled || busy}
            onClick={onAction}
            data-testid="payments-live-sandbox-action"
            sx={{ ...BTN_PRIMARY_SX, minHeight: sxRem(44) }}
          >
            {busy ? <CircularProgress size={18} sx={{ color: 'common.white' }} /> : copy.bandAction}
          </Button>
        ) : null}
        {error ? (
          <Typography role="alert" data-testid="payments-live-sandbox-error" sx={{ fontSize: sxRem(13), color: T.badInk }}>
            {error}
          </Typography>
        ) : null}
      </Stack>
    </Alert>
  );
}
