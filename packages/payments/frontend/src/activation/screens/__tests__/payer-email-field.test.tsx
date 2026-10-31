// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useActivationCharge } from '../../use-activation-charge';
import { ActivationCopyProvider } from '../copy-context';
import { useChangePayerEmail } from '../payer-email-field';

import { TEST_COPY } from './fixtures';

/**
 * FUT-4050 — "Trocar o e-mail", against the REAL charge hook: the refused
 * e-mail must survive the reset it rides on, and the cursor must land on it.
 */

function wrapper({ children }: { children: ReactNode }) {
  return <ActivationCopyProvider copy={TEST_COPY}>{children}</ActivationCopyProvider>;
}

function useStepUnderTest() {
  const charge = useActivationCharge({
    verifyChargeUrl: '/verify/pagbank',
    provider: 'pagbank',
    email: 'dona@loja.example',
    onVerified: () => undefined,
    copy: TEST_COPY.charge,
  });
  const changeEmail = useChangePayerEmail(charge, 'PagBank');
  return { charge, changeEmail };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useChangePayerEmail', () => {
  it('leaves the refusal on the field after the reset, and focuses it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })));
    const input = document.createElement('input');
    input.id = 'verify-charge-email';
    document.body.appendChild(input);

    const { result } = renderHook(useStepUnderTest, { wrapper });
    act(() => result.current.changeEmail());

    expect(result.current.charge.emailError).toBe('PagBank refuses its own account e-mail');
    expect(result.current.charge.state).toEqual({ kind: 'idle' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    input.remove();
  });
});

describe('useChangePayerEmail where the provider requires the e-mail (FUT-4200)', () => {
  it('keeps the field asked for after the reset, so it comes back on the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ publicKey: 'PUBKEY', payerEmailRequired: true }) })),
    );
    const { result } = renderHook(useStepUnderTest, { wrapper });
    await waitFor(() => expect(result.current.charge.payerEmailRequired).toBe(true));
    act(() => result.current.changeEmail());
    expect(result.current.charge.payerEmailRequired).toBe(true);
    expect(result.current.charge.emailError).toBe('PagBank refuses its own account e-mail');
  });
});
