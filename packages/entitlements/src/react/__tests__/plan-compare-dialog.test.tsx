// @vitest-environment jsdom
/**
 * The per-screen plan comparison (FUT-5062): a screen names its rows by
 * STABLE key, and the dialog sets exactly those side by side across the tiers
 * on sale, marks the tenant's own, and ends on the upsell prompt's ask — gated
 * on `plan:request` exactly as that prompt is.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ComparisonLine, ComparisonTier, TenantPlanPayload } from '../../plan-wire';
import { buildMatrix, selectComparisonRows } from '../comparison-rows';
import type { EntitlementsWebCopy } from '../copy';
import { createWebEntitlements } from '../create-web-entitlements';
import { openPlanCompare, type PlanCompareProps } from '../plan-compare-dialog';
import { EN_US_ENTITLEMENTS_WEB_COPY } from '../en-US';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import { raiseUpsell } from '../upsell-channel';
import type { WebEntitlementsConfig } from '../web-config';

const CHAT_KEYS = ['chat.line', 'chat.assistant', 'chat.own-model'];

function line(key: string | undefined, label: string, included: boolean): ComparisonLine {
  return key === undefined ? { label, included, detail: null } : { key, label, included, detail: null };
}

function tier(
  key: string,
  name: string,
  flags: { line: boolean; assistant: boolean; ownModel: boolean },
  over: Partial<ComparisonTier> = {},
): ComparisonTier {
  return {
    key,
    name,
    priceCents: null,
    price: null,
    priceNote: null,
    pitch: '',
    headline: '',
    headlineUnit: '',
    current: false,
    upgrade: true,
    recommended: false,
    sections: [
      {
        title: 'Atendimento',
        lines: [
          line('chat.line', 'Linha de conversa da loja', flags.line),
          line('chat.assistant', 'Assistente automático', flags.assistant),
          line('chat.own-model', 'Usar o seu próprio modelo', flags.ownModel),
        ],
      },
      {
        title: 'Relatórios',
        lines: [line('reports.export', 'Exportar relatórios', true), line(undefined, 'Sem chave', true)],
      },
    ],
    ...over,
  };
}

function tiers(): ComparisonTier[] {
  return [
    tier('starter', 'Inicial', { line: false, assistant: false, ownModel: false }, {
      current: true,
      upgrade: false,
    }),
    tier('pro', 'Pro', { line: true, assistant: true, ownModel: false }),
    tier('max', 'Max', { line: true, assistant: true, ownModel: true }),
  ];
}

function payload(): TenantPlanPayload {
  return {
    planKey: 'starter',
    name: 'Inicial',
    priceCents: 0,
    price: null,
    features: [],
    comparison: tiers(),
  };
}

function fakeHost() {
  const posts: unknown[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/plan') && method === 'GET') {
      return Response.json({ data: { plan: payload() } });
    }
    if (url.endsWith('/plan/request') && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { request: { id: 'r1', status: 'open' }, created: true } });
    }
    return Response.json({ error: 'rota desconhecida' }, { status: 404 });
  };
  return { posts, fetchImpl };
}

function web(over: Partial<WebEntitlementsConfig> = {}, host = fakeHost()) {
  return {
    host,
    entitlements: createWebEntitlements({
      apiBase: '/api/admin/acme',
      fetchImpl: host.fetchImpl,
      canRequestPlanChange: true,
      copy: PT_BR_ENTITLEMENTS_WEB_COPY,
      plansPath: '/acme/planos',
      ...over,
    }),
  };
}

function mountCompare(
  props: Partial<PlanCompareProps> = {},
  over: Partial<WebEntitlementsConfig> = {},
) {
  const { host, entitlements } = web(over);
  const { PlanCompare } = entitlements;
  render(<PlanCompare open onClose={() => undefined} keys={CHAT_KEYS} {...props} />);
  return host;
}

function rowLabels(): string[] {
  return screen
    .getAllByTestId('plan-matrix-row')
    .map((row) => row.querySelector('th')?.textContent ?? '');
}

describe('selectComparisonRows', () => {
  it('keeps every tier, only the keyed lines asked for, and drops emptied sections', () => {
    const selected = selectComparisonRows(tiers(), ['chat.line', 'unknown.key']);
    expect(selected.map((t) => t.key)).toEqual(['starter', 'pro', 'max']);
    expect(selected[0]?.sections.map((s) => s.title)).toEqual(['Atendimento']);
    expect(selected[0]?.sections[0]?.lines.map((l) => l.key)).toEqual(['chat.line']);
  });

  it('never picks a line without a key, even by its label', () => {
    const selected = selectComparisonRows(tiers(), ['Sem chave']);
    expect(buildMatrix(selected)).toEqual([]);
  });

  it('joins a keyed row across tiers that word its label differently', () => {
    const [a, b] = tiers();
    const renamed = { ...b!, sections: [{ title: 'Atendimento', lines: [line('chat.line', 'Outra redação', true)] }] };
    const sections = buildMatrix(selectComparisonRows([a!, renamed], ['chat.line']));
    expect(sections[0]?.rows).toHaveLength(1);
    expect(sections[0]?.rows[0]?.cells.size).toBe(2);
  });
});

describe('the plan comparison dialog', () => {
  it('shows only the rows the screen named, ignoring unknown keys', async () => {
    mountCompare({ keys: ['chat.assistant', 'nope', 'chat.line'] });
    await screen.findByTestId('plan-compare-table');
    // The host's order, not the caller's — and nothing outside the keys.
    expect(rowLabels()).toEqual(['Linha de conversa da loja', 'Assistente automático']);
    expect(screen.queryAllByText('Exportar relatórios')).toHaveLength(0);
    // Every tier on sale, side by side.
    expect(screen.getByTestId('plan-matrix-tier-starter')).toBeDefined();
    expect(screen.getByTestId('plan-matrix-tier-pro')).toBeDefined();
    expect(screen.getByTestId('plan-matrix-tier-max')).toBeDefined();
    // One section left, so no section heading row.
    expect(screen.queryAllByText('ATENDIMENTO')).toHaveLength(0);
  });

  it('says so when none of the keys matches, and still offers every plan', async () => {
    mountCompare({ keys: ['nope'] });
    expect((await screen.findByTestId('plan-compare-empty')).textContent).toBe(
      PT_BR_ENTITLEMENTS_WEB_COPY.planCompare.empty,
    );
    expect(screen.queryAllByTestId('plan-compare-table')).toHaveLength(0);
    expect(screen.queryAllByTestId('upsell-cta')).toHaveLength(0);
    expect(screen.getByTestId('plan-compare-all-plans').getAttribute('href')).toBe('/acme/planos');
  });

  it('with no match, still offers the plan the screen named', async () => {
    mountCompare({ keys: ['nope'], plan: 'max' });
    await screen.findByTestId('plan-compare-empty');
    expect(screen.getByTestId('upsell-plan-name').textContent).toContain('Max');
    expect(screen.getByTestId('upsell-cta')).toBeDefined();
  });

  it("marks the tenant's own tier", async () => {
    mountCompare();
    const current = await screen.findByTestId('plan-matrix-tier-starter');
    expect(current.getAttribute('data-current')).toBe('true');
    expect(within(current).getByTestId('plan-matrix-current').textContent).toBe('Seu plano');
    expect(screen.getByTestId('plan-matrix-tier-max').hasAttribute('data-current')).toBe(false);
    expect(screen.getAllByTestId('plan-matrix-current')).toHaveLength(1);
  });

  it('offers the named plan and files the ask with the feature', async () => {
    const host = mountCompare({ plan: 'max', feature: 'chat.assistant' });
    await waitFor(() =>
      expect(screen.getByTestId('upsell-plan-name').textContent).toContain('Max'),
    );
    fireEvent.click(screen.getByTestId('upsell-cta'));
    await screen.findByTestId('upsell-request-sent');
    expect(host.posts).toEqual([{ requestedPlan: 'max', feature: 'chat.assistant' }]);
  });

  it('without a plan, offers the cheapest upgrade that includes every compared row', async () => {
    mountCompare({ keys: ['chat.line', 'chat.assistant'] });
    await waitFor(() =>
      expect(screen.getByTestId('upsell-plan-name').textContent).toContain('Pro'),
    );
  });

  it('without `plan:request`, names the plan and gives no request button', async () => {
    mountCompare({ plan: 'max' }, { canRequestPlanChange: false });
    await waitFor(() =>
      expect(screen.getByTestId('upsell-plan-name').textContent).toContain('Max'),
    );
    expect(screen.getByTestId('upsell-ask-admin')).toBeDefined();
    expect(screen.queryAllByTestId('upsell-cta')).toHaveLength(0);
  });

  it('offers nothing for a plan that is not an upgrade', async () => {
    mountCompare({ plan: 'starter' });
    await screen.findByTestId('plan-compare-table');
    expect(screen.queryAllByTestId('upsell-plan-name')).toHaveLength(0);
    expect(screen.queryAllByTestId('upsell-cta')).toHaveLength(0);
  });

  it('renders nothing while closed', () => {
    mountCompare({ open: false });
    expect(screen.queryAllByTestId('plan-compare-modal')).toHaveLength(0);
  });
});

describe('a host copy object written before planCompare existed', () => {
  it('still renders the dialog, worded by the en-US pack', async () => {
    const legacy: EntitlementsWebCopy = { ...PT_BR_ENTITLEMENTS_WEB_COPY };
    delete legacy.planCompare;
    mountCompare({ plan: 'max' }, { copy: legacy });
    const modal = await screen.findByTestId('plan-compare-modal');
    expect(within(modal).getByText(EN_US_ENTITLEMENTS_WEB_COPY.planCompare.title)).toBeDefined();
    await screen.findByTestId('plan-compare-table');
    expect(screen.getByTestId('plan-matrix-current').textContent).toBe(
      EN_US_ENTITLEMENTS_WEB_COPY.planCompare.currentBadge,
    );
  });
});

describe('opening it from anywhere', () => {
  it('openPlanCompare opens the comparison in the mounted prompt host', async () => {
    const { UpsellHost } = web().entitlements;
    render(<UpsellHost />);
    act(() => {
      openPlanCompare({ feature: 'chat.assistant', keys: CHAT_KEYS, plan: 'max' });
    });
    expect(screen.getByTestId('plan-compare-modal')).toBeDefined();
    expect(screen.queryAllByTestId('upsell-modal')).toHaveLength(0);
    await screen.findByTestId('plan-compare-table');
    expect(rowLabels()).toHaveLength(3);
  });

  it('a prompt that is not a sale keeps the plain prompt, compare keys or not', async () => {
    const { UpsellHost } = web().entitlements;
    render(<UpsellHost />);
    act(() => {
      raiseUpsell({
        feature: 'chat.assistant',
        requiredPlan: null,
        reason: 'suspended',
        compareKeys: CHAT_KEYS,
      });
    });
    expect(screen.getByTestId('upsell-modal')).toBeDefined();
    await waitFor(() => expect(screen.queryAllByTestId('plan-compare-modal')).toHaveLength(0));
  });
});
