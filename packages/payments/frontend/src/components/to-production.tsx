import { useState } from 'react';

import type { PaymentEnvironment } from '@12-apps/payments-backend';

import { DisconnectDialog } from './ConnectionCard';

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
