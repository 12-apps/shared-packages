'use client';

import { Alert, Button, CircularProgress, Stack } from '@mui/material';
import { useState } from 'react';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { isConnected } from './connection-state';
import { ProbeAlert, ProbeChecklist, type VerifyProbe } from './CredentialFormAlerts';

/**
 * "Testar conexão" for a store whose connection is a GRANT, not a form.
 *
 * On the credentials path the probe runs off the save button — saving IS
 * testing — so it lives inside the credential form. An OAuth store never opens
 * that form: it sits behind the "prefiro informar as credenciais manualmente"
 * disclosure, which the connect card above it says there is no reason to open.
 * The store's own guide told the owner to press "Testar conexão", and the
 * screen offered no such button anywhere they would look (FUT-691).
 *
 * Rendered only once there is a connection to test (`isConnected`, which
 * includes RECONNECT_REQUIRED — a dead grant is exactly what an owner wants to
 * probe). A passing probe is reported by the persistent status chip in the
 * header, exactly as the form's probe is (see {@link ProbeAlert} for why a
 * green banner would say nothing the chip does not); a failure gets the
 * adapter's own sentence.
 */
export function ConnectionProbe({
  descriptor,
  config,
  client,
  reload,
}: {
  descriptor: ProviderDescriptor;
  config: MaskedProviderConfig | null;
  client: PaymentsSettingsClient;
  /** Refresh the settings view — the probe may have moved the stored status. */
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<VerifyProbe | null>(null);
  if (!isConnected(config)) return null;

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      // The ACTIVE environment: it is the one the grant was sealed into and
      // the one the connection card above describes.
      const verified = await client.verify(descriptor.name, config?.environment);
      setProbe(verified.probe);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1} alignItems="flex-start" data-testid="payments-connection-probe">
      <Button
        variant="outlined"
        size="small"
        data-testid="payments-oauth-verify"
        disabled={busy}
        onClick={() => void verify()}
        sx={{ textTransform: 'none' }}
      >
        {busy ? <CircularProgress size={18} /> : 'Testar conexão'}
      </Button>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {probe ? <ProbeAlert probe={probe} busy={busy} onRetry={() => void verify()} /> : null}
      {/* Shown on a pass too — see `ProbeChecklist`: what a green probe did
          NOT check is the half an owner cannot otherwise find out. */}
      {probe ? <ProbeChecklist probe={probe} /> : null}
    </Stack>
  );
}
