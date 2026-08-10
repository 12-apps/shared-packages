'use client';

import { Box, Chip, FormControlLabel, Stack, Switch, Tooltip, Typography } from '@mui/material';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import { isConnected } from './connection-state';

/**
 * The provider's headline: what state it is in, and the switch that decides
 * whether real buyers are sent to it.
 *
 * Its own file since the credential form grew past what one module should
 * carry, and because this bar is rendered above BOTH connection branches —
 * it belongs to the provider, not to the form.
 */

/** What the chip says, in the owner's language, and what it is claiming. */
interface StatusBadge {
  label: string;
  color: 'default' | 'info' | 'success' | 'error';
}

/**
 * Three different facts used to share one word.
 *
 * The chip printed the stored `status` verbatim, so a store that had passed
 * "Testar conexão" read `VERIFIED` — and `VERIFIED` is a claim about
 * CREDENTIALS AUTHENTICATING, nothing more. PagBank answers yes to it while
 * refusing every real charge until homologação; InfinitePay answers yes with
 * Checkout Integrado switched off, which creates no links at all. An owner
 * reading "verified" reasonably concludes the store can take money.
 *
 * So the technical fact and the money fact get different words. `CONEXÃO OK`
 * says the account was reached. `VERIFICADO` is reserved for `chargeVerifiedAt`
 * — a real payment that actually landed — and is the only one painted green.
 */
export function statusBadge(
  config: MaskedProviderConfig | null,
  descriptor?: ProviderDescriptor,
): StatusBadge {
  if (config?.chargeVerifiedAt) return { label: 'VERIFICADO', color: 'success' };
  // A store that has entered nothing has not FAILED at anything. The stored
  // status outlives the credential it described — clearing the field leaves the
  // last verdict behind — so a red FALHOU sat above an empty form, accusing the
  // owner of a mistake they had not yet had the chance to make.
  if (descriptor && !anyCredentialStored(config, descriptor)) {
    return { label: 'NÃO VERIFICADO', color: 'default' };
  }
  if (config?.status === 'RECONNECT_REQUIRED') return { label: 'RECONECTAR', color: 'error' };
  if (isConnected(config)) return { label: 'CONEXÃO OK', color: 'info' };
  // A FAILED probe lands here, and it says NÃO VERIFICADO like every other
  // not-yet-connected state. `FALHOU` was a third word for the same fact — the
  // store cannot take money through this provider yet — and it was the only
  // one painted red, so a mistyped InfiniteTag read as a system fault rather
  // than as a step still to finish. The probe's own sentence is directly
  // underneath and says WHICH tag and WHAT to do about it, which no chip can.
  //
  // `RECONNECT_REQUIRED` stays red on purpose: that one is a connection that
  // WAS working and stopped, which is news rather than a step.
  return { label: 'NÃO VERIFICADO', color: 'default' };
}

/**
 * Does this provider hold any credential at all in the environment in use?
 *
 * Only meaningful for providers that HAVE a credential form: under OAuth the
 * grant is the credential and no field is ever filled, so those keep whatever
 * the probe last said.
 */
function anyCredentialStored(
  config: MaskedProviderConfig | null,
  descriptor: ProviderDescriptor,
): boolean {
  // `?? []` because a descriptor may legitimately declare no schema at all, and
  // a status chip must never be the thing that throws on a settings screen.
  if ((descriptor.credentialSchema ?? []).length === 0) return true;
  if (!config) return false;
  const stored = config.environments[config.environment] ?? {};
  return Object.values(stored).some((field) => field.configured);
}

/**
 * May the switch be touched, and if not, why not?
 *
 * Activation is EARNED BY CHARGING. The status chip cannot be the gate, and
 * that is the whole lesson: `VERIFIED` comes from the credential probe, which
 * only asks whether the keys authenticate. A PagBank Connect grant answers yes
 * to that while refusing every real charge with `403 ACCESS_DENIED` until the
 * integration is homologated — so a store read `PagBank [VERIFIED] [on] Ativo`
 * and declined every shopper.
 *
 * Two qualifications, both learned the hard way:
 *
 *  - Only providers that CAN charge are held to having charged. Every shipped
 *    adapter now declares activationCharge (Stripe's tokenizer and InfinitePay's
 *    hosted link included — FUT-689/FUT-698), so today this spares only an
 *    adapter that genuinely cannot obtain proof.
 *  - Turning OFF is never blocked. An owner must be able to pull a provider out
 *    of rotation at once, and rows enabled before this rule existed would
 *    otherwise be stuck on with no way down.
 *
 * The hint names no amount. It used to promise "a cobrança de teste de R$ 0,01"
 * while the step it points at charges R$ 1,01 for InfinitePay, which refuses a
 * one-cent total outright — the figure is a per-provider fact this component
 * does not have, and quoting it from here could only ever be a guess.
 */
function toggleGate(
  descriptor: ProviderDescriptor,
  config: MaskedProviderConfig | null,
  enabled: boolean,
): { lockedOff: boolean; hint: string } {
  const provable = descriptor.capabilities?.activationCharge === true;
  // `chargeVerifiedAt` PERSISTS once set, so an owner who paused a proven
  // provider can resume it without charging a second time.
  const ready = provable ? Boolean(config?.chargeVerifiedAt) : isConnected(config);
  const lockedOff = !ready && !enabled;
  if (!lockedOff) return { lockedOff, hint: '' };
  return {
    lockedOff,
    hint: provable
      ? 'Este provedor só passa a receber vendas depois dos 3 passos abaixo.'
      : 'Conecte e verifique o provedor antes de ativar as vendas.',
  };
}

/**
 * Status chip + the "recebendo vendas" switch, hoisted OUT of the credential
 * form.
 *
 * These belong to the provider, not to the form: a store that connected by
 * OAuth is told no key needs copying, so it has no reason to open the
 * "Prefiro informar as credenciais manualmente" disclosure — and while this
 * lived inside it, the switch that actually lets checkout charge was hidden in
 * there. The connect card said "conectado" and the page said "nenhum provedor
 * está ativo", with the control to reconcile them out of sight.
 *
 * The switch is labelled with its CONSEQUENCE rather than with "Ativo". "Ativo"
 * is a word about a database row; "Recebendo vendas" is the thing the owner is
 * deciding, and the difference matters most in the state where the control is
 * dead — where "Ativo" plus a greyed-out toggle reads as a broken screen unless
 * you hover it. The reason is printed underneath instead of hidden in a
 * tooltip, since the owner who most needs it is the one who cannot click.
 */
export function ProviderStatusBar({
  descriptor,
  config,
  busy,
  onToggle,
}: {
  descriptor: ProviderDescriptor;
  config: MaskedProviderConfig | null;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const enabled = config?.enabled ?? false;
  const { lockedOff, hint } = toggleGate(descriptor, config, enabled);
  const badge = statusBadge(config, descriptor);

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h6">{descriptor.displayName}</Typography>
        <Chip size="small" data-testid="payments-status" label={badge.label} color={badge.color} />
        {/* The switch belongs at the far edge: it is the one control here that
            changes what buyers experience, and crowding it against the status
            chip made the two read as one compound widget. */}
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title={hint}>
          {/* A disabled control fires no events, so the tooltip needs a live wrapper. */}
          <span>
            <FormControlLabel
              control={
                <Switch
                  data-testid="payments-enabled-toggle"
                  checked={enabled}
                  disabled={busy || lockedOff}
                  onChange={(_, next) => onToggle(next)}
                />
              }
              label={enabled ? 'Recebendo vendas' : 'Não está recebendo'}
            />
          </span>
        </Tooltip>
      </Stack>
      {lockedOff ? (
        <Typography variant="caption" color="text.secondary" data-testid="payments-enable-hint">
          {hint}
        </Typography>
      ) : null}
    </Stack>
  );
}
