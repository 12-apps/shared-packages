// @vitest-environment jsdom
import { cleanup, render, screen } from './settings-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import { certificateExpiryProximity, expiryProximity } from '../components/connection-state';
import { ProviderStatusBar } from '../components/ProviderStatusBar';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * A saved production certificate lapses on its own (Itaú's lives 365 days),
 * and on that day the store's PIX stops. The status bar warns inside the
 * 30-day window the bank opens for renewal, and turns red once the
 * certificate has lapsed — on PRODUCTION only, where it actually matters.
 */

// The status bar reads the real clock, so it is pinned: every instant below is
// a fixed date relative to 2026-10-02 12:00 UTC.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('certificateExpiryProximity', () => {
  it('opens its warning 30 days out — not the OAuth grant’s 7', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(certificateExpiryProximity('2026-10-22T12:00:00Z', now)).toBe('NEAR');
    expect(expiryProximity('2026-10-22T12:00:00Z', now)).toBe('SAFE');
  });

  it('is SAFE beyond the window, PAST once lapsed, and null with nothing to read', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(certificateExpiryProximity('2026-11-02T12:00:00Z', now)).toBe('SAFE');
    expect(certificateExpiryProximity('2026-10-01T12:00:00Z', now)).toBe('PAST');
    expect(certificateExpiryProximity(null, now)).toBeNull();
    expect(certificateExpiryProximity('not-a-date', now)).toBeNull();
  });
});

const ITAU = {
  name: 'itau',
  displayName: 'Itaú',
  capabilities: { activationCharge: false },
} as unknown as ProviderDescriptor;

function itauConfig(environment: 'SANDBOX' | 'PRODUCTION', credentialExpiresAt: string | null): MaskedProviderConfig {
  return {
    provider: 'itau',
    status: 'VERIFIED',
    enabled: true,
    environment,
    chargeVerifiedAt: null,
    credentialExpiresAt,
  } as unknown as MaskedProviderConfig;
}

function renderBar(config: MaskedProviderConfig): void {
  render(<ProviderStatusBar descriptor={ITAU} config={config} busy={false} onToggle={vi.fn()} />);
}

describe('the certificate warning on the status bar', () => {
  it('warns inside the renewal window, naming the date', () => {
    const expiresAt = '2026-10-14T12:00:00.000Z';
    renderBar(itauConfig('PRODUCTION', expiresAt));

    const note = screen.getByTestId('payments-certificate-expiry');
    expect(note.textContent).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.status.certificateExpires(expiresAt));
    expect(note.getAttribute('role')).toBe('status');
  });

  it('turns red once the certificate has lapsed, as a status rather than an alert', () => {
    const expiredAt = '2026-09-30T12:00:00.000Z';
    renderBar(itauConfig('PRODUCTION', expiredAt));

    const note = screen.getByTestId('payments-certificate-expiry');
    expect(note.textContent).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.status.certificateExpired(expiredAt));
    // State on load, not a live event — and the probe's own error is the
    // alert, so a second one would be read out twice.
    expect(note.getAttribute('role')).toBe('status');
  });

  it('says nothing far from expiry, without a certificate, or on a sandbox store', () => {
    renderBar(itauConfig('PRODUCTION', '2027-04-20T12:00:00.000Z'));
    renderBar(itauConfig('PRODUCTION', null));
    renderBar(itauConfig('SANDBOX', '2026-10-07T12:00:00.000Z'));

    expect(screen.queryAllByTestId('payments-certificate-expiry')).toHaveLength(0);
  });

  it('formats the date in the pack’s own locale', () => {
    expect(PT_BR_PAYMENTS_SETTINGS_COPY.status.certificateExpires('2026-11-01T15:00:00.000Z')).toContain('01/11/2026');
  });
});
