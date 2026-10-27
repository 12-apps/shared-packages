import { useState } from 'react';

import type {
  MaskedProviderConfig,
  PaymentEnvironment,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import { soleEnvironment } from './EnvironmentTabs';
import { isConnected } from './connection-state';

/**
 * The connection as this card reads it, with every default applied once.
 *
 * `environment` is the one the provider is configured for — what a CONNECTED
 * card shows, read-only. The one a NEW connect goes to is chosen on the card
 * (see `useConnectEnvironment`).
 */
export function readConnection(config: MaskedProviderConfig | null) {
  return {
    environment: (config?.environment ?? 'SANDBOX') as PaymentEnvironment,
    status: config?.status ?? 'UNVERIFIED',
    connected: isConnected(config),
    expiresAt: config?.expiresAt ?? null,
    account: config?.connectedAccount ?? null,
    receiving: config?.enabled === true,
  };
}

/**
 * Which environment the connect button goes to (FUT-4071).
 *
 * While NOT connected the owner chooses it on the card, and it starts on
 * PRODUCTION whatever the row has stored: a store owner does not know what a
 * sandbox is, and a store whose row happened to be stored as SANDBOX could
 * otherwise only ever reach the provider's test consent page — "Remover
 * conexão" included. The owner overruled the old "a live grant is never the
 * accident" default.
 *
 * Once connected the grant's own environment rules (shown read-only, and
 * Reconectar renews it there): switching would be a new connection, and that
 * starts from "Remover conexão". A provider with a single environment never
 * offers a choice.
 *
 * The manual-credentials disclosure keeps its own tabs. It never shares the
 * screen with this card (one path on screen at a time, `OAuthPanel`), so the
 * choice the owner sees is always the one the button uses.
 */
export function useConnectEnvironment(
  descriptor: ProviderDescriptor,
  stored: PaymentEnvironment,
  connected: boolean,
) {
  const sole = soleEnvironment(descriptor);
  const [chosen, setChosen] = useState<PaymentEnvironment>('PRODUCTION');
  if (sole) return { environment: sole, selectable: false, setChosen };
  if (connected) return { environment: stored, selectable: false, setChosen };
  return { environment: chosen, selectable: true, setChosen };
}
