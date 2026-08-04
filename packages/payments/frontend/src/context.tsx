'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ClientChargeView } from '@12-apps/payments-backend';

import { isSettled, type ClientChargeRequest, type PaymentsClient } from './client';

/**
 * Headless React bindings — state and flow only, ZERO UI. Visual checkout
 * components belong to each host's design system (`@12-apps/ui` here); these
 * hooks make every such UI provider-agnostic: the same `useCreateCharge` +
 * `useChargeStatus` pair drives a PIX QR screen, a card form, or an
 * InfinitePay redirect, switching on `charge.method` / `hostedCheckoutUrl`.
 */

const PaymentsContext = createContext<PaymentsClient | null>(null);

export interface PaymentsProviderProps {
  client: PaymentsClient;
  children: ReactNode;
}

export function PaymentsProvider({ client, children }: PaymentsProviderProps): ReactNode {
  return <PaymentsContext.Provider value={client}>{children}</PaymentsContext.Provider>;
}

export function usePaymentsClient(): PaymentsClient {
  const client = useContext(PaymentsContext);
  if (!client) {
    throw new Error('usePaymentsClient must be used inside a <PaymentsProvider>');
  }
  return client;
}

export interface CreateChargeState {
  charge: ClientChargeView | null;
  loading: boolean;
  error: Error | null;
  create(request: ClientChargeRequest): Promise<ClientChargeView | null>;
  reset(): void;
}

/** Imperative charge creation with loading/error state. */
export function useCreateCharge(): CreateChargeState {
  const client = usePaymentsClient();
  const [charge, setCharge] = useState<ClientChargeView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(
    async (request: ClientChargeRequest) => {
      setLoading(true);
      setError(null);
      try {
        const created = await client.createCharge(request);
        setCharge(created);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  const reset = useCallback(() => {
    setCharge(null);
    setError(null);
  }, []);

  return { charge, loading, error, create, reset };
}

export interface ChargeStatusOptions {
  /** Poll interval; default 4000ms. Polling stops on settled states. */
  intervalMs?: number;
}

export interface ChargeStatusState {
  charge: ClientChargeView | null;
  /** True once the charge reached a state that will not change by waiting. */
  settled: boolean;
  error: Error | null;
}

/** Identifies one charge to poll: which provider, which provider-side id. */
export interface ChargeRef {
  provider: string;
  providerChargeId: string;
}

/**
 * Polls the host for a charge until it settles (webhooks update the server;
 * the browser polls the server — never the provider). Pass `null` to idle.
 */
export function useChargeStatus(
  ref: ChargeRef | null,
  options: ChargeStatusOptions = {},
): ChargeStatusState {
  const client = usePaymentsClient();
  const intervalMs = options.intervalMs ?? 4000;
  const [charge, setCharge] = useState<ClientChargeView | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const settled = charge !== null && isSettled(charge.status);
  const settledRef = useRef(settled);
  settledRef.current = settled;
  const provider = ref?.provider ?? null;
  const providerChargeId = ref?.providerChargeId ?? null;

  useEffect(() => {
    if (!provider || !providerChargeId) return undefined;
    let disposed = false;

    const tick = async (): Promise<void> => {
      if (disposed || settledRef.current) return;
      try {
        const fresh = await client.getCharge(provider, providerChargeId);
        if (!disposed) setCharge(fresh);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [client, provider, providerChargeId, intervalMs]);

  return { charge, settled, error };
}
