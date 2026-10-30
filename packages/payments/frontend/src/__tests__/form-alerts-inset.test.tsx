// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from './settings-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { ProviderForm } from '../components/ProviderCredentialForm';

/**
 * The credential form's own alerts keep the card's inset (FUT-4144).
 *
 * The card body has no padding of its own (`ProviderCard`), so every block in
 * it sets the inset itself. A guide insets the boxes it holds, but the form's
 * error, the probe's verdict and the checklist of what could not be tied to a
 * box render after the guide, and ran into the card's edges — on the
 * credentials-mode card and on an OAuth card with no connect button. With no
 * guide at all the boxes themselves did too.
 */

const DESCRIPTOR = {
  name: 'acme',
  displayName: 'Acme',
  authMode: 'credentials',
  credentialSchema: [{ key: 'token', label: 'Token', secret: true, required: true }],
} as unknown as ProviderDescriptor;

const EMPTY = {
  provider: 'acme',
  status: 'UNVERIFIED',
  enabled: false,
  chargeVerifiedAt: null,
  environment: 'SANDBOX',
  environments: { SANDBOX: {}, PRODUCTION: {} },
} as unknown as MaskedProviderConfig;

const STORED = {
  ...EMPTY,
  environments: { SANDBOX: { token: { configured: true, hint: '••••42' } }, PRODUCTION: {} },
} as unknown as MaskedProviderConfig;

const PROBE = {
  ok: false,
  environment: 'SANDBOX',
  message: 'Credenciais recusadas.',
  checks: [{ key: 'account', status: 'UNCHECKED', message: 'Conta não consultada.' }],
};

function clientThat(save: 'fails' | 'probes'): PaymentsSettingsClient {
  return {
    baseUrl: '/api/admin/acme/payments',
    saveCredentials:
      save === 'fails' ? vi.fn().mockRejectedValue(new Error('boom')) : vi.fn().mockResolvedValue(STORED),
    verify: vi.fn().mockResolvedValue({ ...STORED, probe: PROBE }),
  } as unknown as PaymentsSettingsClient;
}

/** A stand-in walkthrough: holds the form's boxes, as the real one does, and pads them itself. */
function guide(slots: { rows: ReactNode; sectionFooter: ReactNode }): ReactNode {
  return (
    <div data-testid="guide" style={{ padding: '0 20px' }}>
      {slots.rows}
      {slots.sectionFooter}
    </div>
  );
}

function renderForm(save: 'fails' | 'probes', guided: boolean): HTMLElement {
  const { container } = render(
    <ProviderForm
      descriptor={DESCRIPTOR}
      config={EMPTY}
      client={clientThat(save)}
      environment="SANDBOX"
      editing={false}
      onEditingChange={() => undefined}
      onSaved={() => undefined}
      renderGuide={guided ? guide : undefined}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^Token/), { target: { value: 'tok_novo' } });
  fireEvent.click(screen.getByTestId('payments-save'));
  return container;
}

/** The horizontal inset `element` gets from its ancestors, up to (not including) `stop`. */
function insetWithin(element: Element, stop: Element): number {
  const ancestors: Element[] = [];
  for (let node = element.parentElement; node && node !== stop; node = node.parentElement) ancestors.push(node);
  return ancestors.reduce((total, node) => total + (Number.parseFloat(getComputedStyle(node).paddingLeft) || 0), 0);
}

async function errorAlert(): Promise<Element> {
  return waitFor(() => {
    const alert = document.querySelector('.MuiAlert-standardError, .MuiAlert-colorError');
    if (!alert) throw new Error('no error alert yet');
    return alert;
  });
}

afterEach(cleanup);

describe.each([
  ['inside a guide', true],
  ['with no guide', false],
])("the credential form's alerts, %s", (_case, guided) => {
  it('inset the save error by the card inset, once', async () => {
    const container = renderForm('fails', guided);
    expect(insetWithin(await errorAlert(), container)).toBe(20);
  });

  it("inset the probe's verdict and its leftover checks by the card inset, once", async () => {
    const container = renderForm('probes', guided);
    const verdict = await screen.findByTestId('payments-probe-result');
    const checks = await screen.findByTestId('payments-probe-checks');
    expect(insetWithin(verdict, container)).toBe(20);
    expect(insetWithin(checks, container)).toBe(20);
  });
});

describe('the credential boxes', () => {
  it('are inset by the card inset when no guide holds them', () => {
    const { container } = render(
      <ProviderForm
        descriptor={DESCRIPTOR}
        config={EMPTY}
        client={clientThat('probes')}
        environment="SANDBOX"
        editing={false}
        onEditingChange={() => undefined}
        onSaved={() => undefined}
      />,
    );
    const box = screen.getByLabelText(/^Token/).closest('.MuiTextField-root') as Element;
    expect(insetWithin(box, container)).toBe(20);
  });

  it('take no inset from the form when a guide holds them', () => {
    const container = renderForm('probes', true);
    expect(insetWithin(screen.getByTestId('guide'), container)).toBe(0);
  });
});

/** Total padding of a side on the way from `stop` down to `element`. */
function paddingWithin(element: Element, stop: Element, side: 'paddingBottom' | 'paddingRight' | 'paddingTop'): number {
  const ancestors: Element[] = [];
  for (let node = element.parentElement; node && node !== stop; node = node.parentElement) ancestors.push(node);
  return ancestors.reduce((total, node) => total + (Number.parseFloat(getComputedStyle(node)[side]) || 0), 0);
}

/**
 * The alerts are the last thing in the card, and its body has no padding of its
 * own: with only a side inset the red box sat on the card's bottom edge, its
 * corners against the card's (FUT-4144 UI review). They end the card the way
 * they start it — by the card inset.
 */
describe.each([
  ['inside a guide', true],
  ['with no guide', false],
])("the credential form's alerts, %s, at the bottom of the card", (_case, guided) => {
  it('keep the card inset below them', async () => {
    const container = renderForm('fails', guided);
    const alert = await errorAlert();
    expect(paddingWithin(alert, container, 'paddingBottom')).toBe(20);
    expect(paddingWithin(alert, container, 'paddingRight')).toBe(20);
  });
});

/**
 * With no guide the alerts follow the save bar directly. They used to share the
 * fields' stack, which spaced the first one 16px below the bar; on their own
 * stack they sat on the bar's bottom edge (FUT-4144 code review round 2).
 */
describe("the credential form's alerts with no guide", () => {
  it('keep the stack gap below the save bar', async () => {
    const container = renderForm('fails', false);
    const alert = await errorAlert();
    expect(paddingWithin(alert, container, 'paddingTop')).toBe(16);
  });
});

/**
 * The save bar's sentence and button line up with the boxes above them.
 *
 * The bar carried 18px of its own on top of whatever held it — a step panel
 * already padded by 18, or the form's card inset — so its text and button sat
 * 18px inside the boxes and the rule it draws (FUT-4144 UI review). The boxes'
 * container is the bar's container too; the bar adds nothing.
 */
describe.each([
  ['inside a guide', true],
  ['with no guide', false],
])('the save bar, %s', (_case, guided) => {
  afterEach(() => cleanup());

  it('adds no side padding of its own', () => {
    renderForm('probes', guided);
    const bar = screen.getByTestId('payments-form-bar');
    expect(Number.parseFloat(getComputedStyle(bar).paddingLeft) || 0).toBe(0);
    expect(Number.parseFloat(getComputedStyle(bar).paddingRight) || 0).toBe(0);
  });

  it('starts its sentence where the boxes start', () => {
    const container = renderForm('probes', guided);
    const box = screen.getByLabelText(/^Token/).closest('.MuiTextField-root') as Element;
    const sentence = screen.getByTestId('payments-form-bar').firstElementChild as Element;
    expect(insetWithin(sentence, container)).toBe(insetWithin(box, container));
  });
});
