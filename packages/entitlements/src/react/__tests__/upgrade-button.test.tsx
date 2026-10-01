// @vitest-environment jsdom
/**
 * The way out of a refused request (FUT-3137): a host hands the button the
 * refusal it already shows, and the button decides whether an upgrade fixes
 * it. A click lands on the same prompt every other trigger opens.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createWebEntitlements } from '../create-web-entitlements';
import { EN_US_ENTITLEMENTS_WEB_COPY } from '../en-US';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import { subscribeToUpsell } from '../upsell-channel';
import type { EntitlementsWebCopy } from '../copy';

/** A seat refusal, as `entitlementDenialResponse` writes one. */
const SEATS_FULL = {
  error: 'Seu plano não tem mais vagas para Administrador.',
  code: 'quota_exceeded',
  feature: 'team.seats',
  used: 3,
  limit: 1,
  requiredPlan: 'basic',
};

function surface(copy: EntitlementsWebCopy = PT_BR_ENTITLEMENTS_WEB_COPY) {
  return createWebEntitlements({
    apiBase: '/api/admin/acme',
    fetchImpl: async () => Response.json({ error: 'sem rede' }, { status: 503 }),
    canRequestPlanChange: true,
    copy,
    plansPath: '/acme/planos',
    switchLocation: () => ({ path: '/acme/alertas', label: 'Ajustes › Alertas' }),
  });
}

/** Every prompt raised while the test runs. */
function raised(): unknown[] {
  const prompts: unknown[] = [];
  const unsubscribe = subscribeToUpsell((prompt) => prompts.push(prompt));
  onTestFinished(unsubscribe);
  return prompts;
}

function buttons(): number {
  return screen.queryAllByTestId('upgrade-button').length;
}

describe('the upgrade button', () => {
  it('offers the plan a spent quota needs, and opens the upgrade prompt on it', () => {
    const prompts = raised();
    const { UpgradeButton, UpsellHost } = surface();
    render(
      <>
        <UpgradeButton status={402} body={SEATS_FULL} />
        <UpsellHost />
      </>,
    );

    const button = screen.getByTestId('upgrade-button');
    expect(button.textContent).toBe('Ver planos');
    fireEvent.click(button);

    expect(prompts).toEqual([
      {
        feature: 'team.seats',
        requiredPlan: 'basic',
        reason: 'quota-exceeded',
        quota: { used: 3, limit: 1 },
      },
    ]);
    expect(screen.getAllByTestId('upsell-modal').length).toBeGreaterThan(0);
  });

  it('reads its label from the surface copy', () => {
    const { UpgradeButton } = surface(EN_US_ENTITLEMENTS_WEB_COPY);
    render(<UpgradeButton status={402} body={SEATS_FULL} />);
    expect(screen.getByTestId('upgrade-button').textContent).toBe('See plans');
  });

  it.each([
    ['a refusal that is not a 402', 400, { error: 'E-mail inválido.' }],
    ['a 402 with no entitlement code', 402, { error: 'Pagamento.' }],
    ['a plan denial with no plan to offer', 402, { ...SEATS_FULL, requiredPlan: null }],
    ['a request that never reached the server', undefined, undefined],
  ])('renders nothing for %s', (_case, status, body) => {
    const prompts = raised();
    const { UpgradeButton } = surface();
    render(<UpgradeButton status={status} body={body} />);
    expect(buttons()).toBe(0);
    expect(prompts).toEqual([]);
  });

  it('a feature the plan lacks is offered too', () => {
    const { UpgradeButton } = surface();
    const click = vi.fn();
    const unsubscribe = subscribeToUpsell(click);
    onTestFinished(unsubscribe);
    render(
      <UpgradeButton
        status={402}
        body={{ error: 'x', code: 'entitlement_required', feature: 'ai.chat', requiredPlan: 'pro' }}
      />,
    );
    fireEvent.click(screen.getByTestId('upgrade-button'));
    expect(click).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'ai.chat', requiredPlan: 'pro', reason: 'not-entitled' }),
    );
  });
});
