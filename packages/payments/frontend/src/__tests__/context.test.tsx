// @vitest-environment jsdom
// fireEvent/render from @testing-library/react (act()-wrapped) — same choice
// and reasoning as @12-apps/entitlements' react tests: user-event is not a
// dependency of this package.
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ClientChargeView } from '@12-apps/payments-backend';
import type { PaymentsClient } from '../client';
import { PaymentsProvider, useChargeStatus, useCreateCharge } from '../context';

function chargeView(status: ClientChargeView['status']): ClientChargeView {
  return {
    provider: 'stone',
    providerChargeId: 'chg-1',
    status,
    amount: { amountCents: 12_50, currency: 'BRL' },
    method: 'PIX',
    pix: { qrText: 'qr-payload' },
  };
}

function fakeClient(overrides: Partial<PaymentsClient> = {}): PaymentsClient {
  return {
    getConfig: vi.fn().mockResolvedValue(null),
    createCharge: vi.fn().mockResolvedValue(chargeView('PENDING')),
    getCharge: vi.fn().mockResolvedValue(chargeView('PAID')),
    ...overrides,
  };
}

function CreateProbe() {
  const { charge, create } = useCreateCharge();
  useEffect(() => {
    void create({
      method: 'PIX',
      customer: { name: 'Ana', email: 'ana@example.com' },
      orderRef: 'order-1',
    });
  }, [create]);
  if (!charge) return <span>creating</span>;
  return <span>status:{charge.status}</span>;
}

function StatusProbe() {
  const { charge, settled } = useChargeStatus({ provider: 'stone', providerChargeId: 'chg-1' }, { intervalMs: 5 });
  return (
    <span>
      poll:{charge?.status ?? 'none'}:{settled ? 'settled' : 'waiting'}
    </span>
  );
}

describe('payments react bindings', () => {
  it('useCreateCharge creates via the client and exposes the charge', async () => {
    const client = fakeClient();
    render(
      <PaymentsProvider client={client}>
        <CreateProbe />
      </PaymentsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('status:PENDING')).toBeDefined();
    });
    expect(client.createCharge).toHaveBeenCalledTimes(1);
  });

  it('useChargeStatus polls until the charge settles', async () => {
    const client = fakeClient();
    render(
      <PaymentsProvider client={client}>
        <StatusProbe />
      </PaymentsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('poll:PAID:settled')).toBeDefined();
    });
    expect(client.getCharge).toHaveBeenCalledWith('stone', 'chg-1');
  });

  it('hooks throw outside a <PaymentsProvider>', () => {
    // Silence React's error boundary logging for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<StatusProbe />)).toThrow(/PaymentsProvider/);
    spy.mockRestore();
  });
});
