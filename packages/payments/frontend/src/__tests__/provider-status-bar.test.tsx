// @vitest-environment jsdom
import { cleanup, render, screen } from './settings-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import { ProviderStatusBar } from '../components/ProviderStatusBar';

/**
 * "Ativo" decides whether checkout routes real buyers to this provider, so it
 * must not be offerable before there is anything to route to. The screen shipped
 * showing `PagBank [UNVERIFIED] [on] Ativo` — a provider that had never proved
 * it could charge, presented as live.
 */

/** A provider that CAN run the activation charge, so the strict rule applies. */
const DESCRIPTOR = {
  name: 'pagbank',
  displayName: 'PagBank',
  capabilities: { activationCharge: true },
} as unknown as ProviderDescriptor;

/**
 * One that cannot: no browser tokenization is written for it, so there is no
 * way to earn `chargeVerifiedAt`. Holding it to the charge would not make
 * "Ativo" honest — it would make the provider permanently unactivatable.
 */
const NO_CHARGE_PATH = {
  name: 'stripe',
  displayName: 'Stripe',
  capabilities: { activationCharge: false },
} as unknown as ProviderDescriptor;

function configWith(
  status: string,
  enabled = false,
  chargeVerifiedAt: string | null = null,
): MaskedProviderConfig {
  return {
    provider: 'pagbank',
    status,
    enabled,
    chargeVerifiedAt,
  } as unknown as MaskedProviderConfig;
}

const PROVEN = '2026-07-30T12:00:00.000Z';

/**
 * jest-dom is not a dependency here, so assert the DOM property directly. The
 * testid lands on MUI's Switch ROOT; the thing that carries `disabled` is the
 * checkbox input inside it.
 */
function toggle(): HTMLInputElement {
  const root = screen.getByTestId('payments-enabled-toggle');
  const input = root.querySelector('input[type="checkbox"]');
  if (!input) throw new Error('switch input not found');
  return input as HTMLInputElement;
}

afterEach(cleanup);

describe('ProviderStatusBar — the Ativo switch', () => {
  it('cannot be switched on with no connection at all', () => {
    render(<ProviderStatusBar descriptor={DESCRIPTOR} config={null} busy={false} onToggle={vi.fn()} />);
    expect(toggle().disabled).toBe(true);
  });

  it('cannot be switched on while the provider is UNVERIFIED', () => {
    render(
      <ProviderStatusBar
        descriptor={DESCRIPTOR}
        config={configWith('UNVERIFIED')}
        busy={false}
        onToggle={vi.fn()}
      />,
    );
    expect(toggle().disabled).toBe(true);
  });

  /**
   * The one this exists for. `VERIFIED` comes from the credential probe, which
   * only asks whether the keys authenticate — PagBank answers yes to that and
   * still refuses every real charge until the integration is homologated. A
   * store sat at `PagBank [VERIFIED] [on] Ativo` while declining every shopper.
   */
  it('stays locked at VERIFIED — authenticating is not being able to charge', () => {
    render(
      <ProviderStatusBar
        descriptor={DESCRIPTOR}
        config={configWith('VERIFIED')}
        busy={false}
        onToggle={vi.fn()}
      />,
    );
    expect(toggle().disabled).toBe(true);
  });

  it('unlocks once a real charge has succeeded', () => {
    render(
      <ProviderStatusBar
        descriptor={DESCRIPTOR}
        config={configWith('VERIFIED', false, PROVEN)}
        busy={false}
        onToggle={vi.fn()}
      />,
    );
    expect(toggle().disabled).toBe(false);
  });

  /**
   * Turning OFF is never gated. A row enabled before this rule existed — or a
   * store in RECONNECT_REQUIRED that demonstrably worked — must be pullable out
   * of rotation at once, or the switch traps an owner with a broken provider
   * live in the chain.
   */
  it('lets an enabled-but-unproven provider be switched off', () => {
    render(
      <ProviderStatusBar
        descriptor={DESCRIPTOR}
        config={configWith('RECONNECT_REQUIRED', true)}
        busy={false}
        onToggle={vi.fn()}
      />,
    );
    expect(toggle().disabled).toBe(false);
  });

  it('falls back to VERIFIED for a provider that cannot run the charge', () => {
    render(
      <ProviderStatusBar
        descriptor={NO_CHARGE_PATH}
        config={configWith('VERIFIED')}
        busy={false}
        onToggle={vi.fn()}
      />,
    );
    expect(toggle().disabled).toBe(false);
  });

  it('is locked while another action is in flight', () => {
    render(
      <ProviderStatusBar
        descriptor={DESCRIPTOR}
        config={configWith('VERIFIED', false, PROVEN)}
        busy
        onToggle={vi.fn()}
      />,
    );
    expect(toggle().disabled).toBe(true);
  });
});
