import { useState } from 'react';

import type { MaskedProviderConfig, PaymentEnvironment } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { DisconnectDialog } from './ConnectionCard';
import { sandboxRefused } from './connection-state';
import { describeFailure } from './failure-copy';
import { LiveSandboxBand } from './LiveSandboxBand';
import type { ActivePanelProps } from './ProviderPanel';
import { usePaymentsFailureCopy } from './settings-copy-context';

/**
 * Is this connection an OAuth GRANT? Its identity fields are present
 * (`connectedAccount !== null`: a grant always stamps `connectedAt`);
 * otherwise it is the credentials path — keys pasted by hand.
 */
export function isGrant(config: MaskedProviderConfig | null | undefined): boolean {
  return config?.connectedAccount != null;
}

/** PRODUCTION credentials already on record for this connection. */
export function productionStored(config: MaskedProviderConfig | null | undefined): boolean {
  return Object.values(config?.environments.PRODUCTION ?? {}).some((field) => field.configured);
}

/**
 * Switch a connection to the PRODUCTION credentials it already holds — a save
 * of that environment with nothing changed, today's path: nothing is removed
 * and nobody leaves for the provider (owner decision 4).
 */
function useSwitchToProduction(client: PaymentsSettingsClient, provider: string, reload: () => void) {
  const failures = usePaymentsFailureCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.saveCredentials(provider, { environment: 'PRODUCTION', fields: {} });
      reload();
    } catch (err) {
      setError(describeFailure(err, failures));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/**
 * A refused sandbox on the OAuth panel (FUT-4432): the band under the header,
 * and what its button does, in this order:
 *
 *  - PRODUCTION keys already on record: switch to them by saving PRODUCTION.
 *    Never `disconnectOAuth`, which wipes BOTH environments.
 *  - an OAuth grant: today's removal dialog in its "to Produção" variant
 *    (`ProviderConnection` owns it), then the connect in PRODUCTION;
 *  - pasted keys: the manual path, on Produção.
 *
 * Only a grant on an installation with no connect button gets no button. The
 * activation step is withheld meanwhile (the caller), and returns once the
 * store is connected in Produção.
 */
export function useLiveSandbox(
  io: Pick<ActivePanelProps, 'descriptor' | 'config' | 'client' | 'reload' | 'prepareConnect' | 'nextInLine' | 'readOnly'> & {
    toProductionTab?: () => void;
  },
  setManual: (manual: boolean) => void,
) {
  const [open, setOpen] = useState(false);
  const save = useSwitchToProduction(io.client, io.descriptor.name, io.reload);
  const refused = sandboxRefused(io.config);
  if (!refused) return { refused, band: undefined, toProduction: undefined };
  const grant = isGrant(io.config);
  const stored = productionStored(io.config);
  const action = () => {
    if (stored) return void save.run();
    setManual(!grant);
    if (grant) setOpen(true);
    else io.toProductionTab?.();
  };
  const offered = stored || !grant || Boolean(io.prepareConnect);
  const band = (
    <LiveSandboxBand
      nextInLine={io.nextInLine === true}
      disabled={io.readOnly === true}
      busy={save.busy}
      error={save.error}
      onAction={offered ? action : undefined}
    />
  );
  return { refused, band, toProduction: grant && !stored ? { open, onClose: () => setOpen(false) } : undefined };
}

/**
 * "Conectar em Produção" for a grant in a refused sandbox (FUT-4432), in the
 * order that keeps every outcome on screen: remove (a failure stays in the
 * dialog) → the removal's re-read → close → connect in PRODUCTION, passed
 * explicitly, with Produção selected for a retry should the start fail.
 */
export function useToProduction(io: {
  run: (kind: string, action: () => Promise<void>, sink?: (message: string | null) => void) => Promise<boolean>;
  connect: (target: PaymentEnvironment) => Promise<boolean>;
  setChosen: (environment: PaymentEnvironment) => void;
  removeGrant: () => Promise<unknown>;
  onClose?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    const removed = await io.run('disconnect', async () => void (await io.removeGrant()), setError);
    if (!removed) return;
    io.onClose?.();
    io.setChosen('PRODUCTION');
    await io.connect('PRODUCTION');
  };
  const dismiss = () => {
    setError(null);
    io.onClose?.();
  };
  return { error, confirm, dismiss };
}

/** Today's removal dialog in its "to Produção" variant, driven by {@link useToProduction}. */
export function ToProductionDialog(props: {
  open: boolean | undefined;
  displayName: string;
  busy: boolean;
  flow: ReturnType<typeof useToProduction>;
}) {
  if (props.open === undefined) return null;
  return (
    <DisconnectDialog
      variant="toProduction"
      open={props.open}
      displayName={props.displayName}
      busy={props.busy}
      receiving={false}
      error={props.flow.error}
      onCancel={props.flow.dismiss}
      onConfirm={() => void props.flow.confirm()}
    />
  );
}
