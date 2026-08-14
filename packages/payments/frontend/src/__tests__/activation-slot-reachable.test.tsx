// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MerchantSettingsView, PaymentProviderAdapter } from '@12-apps/payments-backend';
import { infinitePayProvider } from '@12-apps/payments-backend/providers/infinitepay';
import { stoneProvider } from '@12-apps/payments-backend/providers/stone';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';

/**
 * Can a connected store actually REACH the step that switches it on?
 *
 * Driven by each adapter's REAL guide, which is the whole point: every existing
 * test in this package builds a guide by hand, or stubs `getSetupGuide` to
 * `null` — and a null guide makes `openSection` return null, which opens the
 * activation slot unconditionally. So Stripe's activation flow was covered by a
 * green test (`stripe-activation-flow.test.tsx`) while no Stripe store on earth
 * could be enabled (FUT-799), and Stone's the same (FUT-800).
 *
 * The deadlock those two shared: the host's activation card renders only once
 * the walkthrough has run out of sections, both guides paired a section with
 * their last stage, and neither reported an `activeStage` that reached it. That
 * card is the only control raising the charge that stamps `chargeVerifiedAt`,
 * and `proofMissing` refuses to enable a provider without it — so the store was
 * held behind a step it could not get to.
 *
 * `providers.test.ts` pins the guide SHAPE that makes this possible. This pins
 * the consequence, through the renderer that reads it.
 */

interface Case {
  adapter: PaymentProviderAdapter;
  /** Stored fields for the environment on screen — enough to look connected. */
  stored: Record<string, { configured: boolean; hint?: string }>;
  /** The section the walkthrough rests on while the owner still owes it. */
  restingSection: string;
  /** The confirm button's copy — each vendor's own, never another's. */
  confirmLabel: RegExp;
}

const CASES: Case[] = [
  {
    adapter: stripeProvider(),
    // OAuth stores fill in nothing; the grant IS the credential.
    stored: {},
    restingSection: 'dashboard',
    confirmLabel: /Já configurei minha conta na Stripe/i,
  },
  {
    adapter: stoneProvider(),
    stored: {
      secretKey: { configured: true },
      publicKey: { configured: true, hint: 'pk_test_1' },
      webhookUser: { configured: true, hint: 'loja' },
      webhookPassword: { configured: true },
    },
    restingSection: 'webhook',
    confirmLabel: /Já cadastrei a URL no painel/i,
  },
  {
    adapter: infinitePayProvider(),
    stored: { handle: { configured: true, hint: '$loja' } },
    restingSection: 'enable',
    // Authors no `confirmLabel`, so the renderer's fallback applies — this is
    // the guide the old hardcoded constant was written for, unchanged.
    confirmLabel: /Já habilitei o Checkout Integrado/i,
  },
];

function viewFor({ adapter, stored }: Case, chargeVerifiedAt: string | null): MerchantSettingsView {
  return {
    providers: [
      {
        name: adapter.name,
        displayName: adapter.displayName,
        urlSlug: adapter.urlSlug ?? adapter.name,
        capabilities: adapter.capabilities,
        authMode: adapter.authMode ?? 'credentials',
        credentialSchema: adapter.credentialSchema,
      },
    ],
    configs: [
      {
        provider: adapter.name,
        status: 'VERIFIED',
        enabled: false,
        chargeVerifiedAt,
        environment: 'SANDBOX',
        environments: { SANDBOX: stored, PRODUCTION: {} },
      },
    ],
    activeProvider: null,
  } as unknown as MerchantSettingsView;
}

/**
 * The guide the SERVER would answer with, for a store that is connected and
 * has not yet charged — the state every one of these bugs lived in.
 */
function guideFor(adapter: PaymentProviderAdapter, proven: boolean) {
  return adapter.setupGuide?.({
    brandName: 'Plataforma Exemplo',
    webhookUrl: `https://host.example/api/webhooks/payments/acme/${adapter.name}`,
    progress: { configured: {}, connected: true, proven },
  });
}

function renderSettings(testCase: Case, { proven = false } = {}) {
  const { adapter } = testCase;
  const chargeVerifiedAt = proven ? '2026-08-01T12:00:00.000Z' : null;
  const client = {
    baseUrl: '/api/admin/acme/payments',
    getSettings: vi.fn().mockResolvedValue(viewFor(testCase, chargeVerifiedAt)),
    getSetupGuide: vi.fn().mockResolvedValue(guideFor(adapter, proven)),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;

  render(
    <PaymentProviderSettings
      client={client}
      initialProvider={adapter.name}
      // The OAuth providers' real screen has a working connect button, which is
      // what moves the walkthrough out of the manual-credentials disclosure.
      prepareConnect={vi.fn()}
      renderVerification={({ blocked, hidden }) => (
        <div data-testid="step-three" data-hidden={hidden} data-blocked={blocked} />
      )}
    />,
  );
}

/** The screen's whole async boot: settings, then the guide keyed on it. */
const LANDED = { timeout: 10_000 };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe.each(CASES)('$adapter.displayName — the activation slot', (testCase) => {
  /**
   * The step no API can answer holds the walkthrough, and the activation card
   * is told it is not the current step. That much was never broken.
   */
  it('rests on the step the owner still owes, activation withheld', async () => {
    renderSettings(testCase);

    await screen.findByTestId(
      `payments-setup-section-${testCase.restingSection}`,
      undefined,
      LANDED,
    );
    const step = await screen.findByTestId('step-three', undefined, LANDED);
    await waitFor(() => expect(step.dataset['hidden']).toBe('true'));
    expect(step.dataset['blocked']).toBe('true');
  });

  /**
   * The button has to name what the owner is agreeing to. Its copy used to be a
   * constant — "Já habilitei o Checkout Integrado" — so Stripe and Stone asked
   * store owners to confirm a product neither of them sells.
   */
  it('asks in this vendor’s own words', async () => {
    renderSettings(testCase);

    await screen.findByRole('button', { name: testCase.confirmLabel }, LANDED);
  });

  /**
   * THE regression. Confirming is the last thing standing between a connected
   * store and the charge that enables it — and for Stripe and Stone nothing
   * happened here at all, because the last stage carried a section and the card
   * had nowhere to appear.
   */
  it('hands the slot over once the owner confirms', async () => {
    renderSettings(testCase);

    const confirm = await screen.findByRole('button', { name: testCase.confirmLabel }, LANDED);
    fireEvent.click(confirm);

    const step = screen.getByTestId('step-three');
    await waitFor(() => expect(step.dataset['hidden']).toBe('false'));
    expect(step.dataset['blocked']).toBe('false');
    // Collapsed to a row rather than removed: it is the claim the charge is
    // about to test, and the owner needs somewhere to press Revisar — which is
    // also what keeps the notification URL reachable after connecting.
    expect(screen.getByTestId('payments-setup-confirmed')).toBeTruthy();
  });

  /**
   * A store that has already paid is never sent back through the walkthrough —
   * the card is what reports the charge that proved it.
   */
  it('never withholds the slot from a store that has already charged', async () => {
    renderSettings(testCase, { proven: true });

    const step = await screen.findByTestId('step-three', undefined, LANDED);
    await waitFor(() => expect(step.dataset['hidden']).toBe('false'));
  });
});
