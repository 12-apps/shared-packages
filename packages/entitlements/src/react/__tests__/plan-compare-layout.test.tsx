// @vitest-environment jsdom
/**
 * The plan comparison, round 2 (FUT-5062 review): the layout is chosen by the
 * width the dialog MEASURED (a table where its floors fit, stacked rows
 * anywhere narrower), nothing is sold when the tenant's tier already covers
 * the screen, the offered tier is worded in the table, a failed read can be
 * retried, and every raise is a fresh dialog.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ComparisonTier, TenantPlanPayload } from '../../plan-wire';
import { buildMatrix, selectComparisonRows } from '../comparison-rows';
import { createWebEntitlements } from '../create-web-entitlements';
import { openPlanCompare } from '../plan-compare-dialog';
import { CompareMatrixView, compareOffer, matrixLayoutFor } from '../plan-compare-layout';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import type { WebEntitlementsConfig } from '../web-config';

const COPY = PT_BR_ENTITLEMENTS_WEB_COPY;
const KEYS = ['chat.line', 'chat.assistant', 'chat.own-model'];

function tier(
  key: string,
  flags: [boolean, boolean, boolean],
  over: Partial<ComparisonTier> = {},
): ComparisonTier {
  const labels = ['Linha de conversa', 'Assistente automático', 'Seu próprio modelo'];
  return {
    key,
    name: key.toUpperCase(),
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
        lines: KEYS.map((key, i) => ({
          key,
          label: labels[i] ?? key,
          included: flags[i] ?? false,
          detail: null,
        })),
      },
    ],
    ...over,
  };
}

/** Free, Basic, Pro, Max — the four tiers the first caller's host sells. */
function fourTiers(): ComparisonTier[] {
  return [
    tier('free', [false, false, false], { current: true, upgrade: false }),
    tier('basic', [true, false, false]),
    tier('pro', [true, true, false]),
    tier('max', [true, true, true]),
  ];
}

/** The same ladder where even the tenant's own tier has every row. */
function coveredTiers(): ComparisonTier[] {
  return fourTiers().map((t) => ({ ...t, sections: tier(t.key, [true, true, true]).sections }));
}

function payloadOf(comparison: ComparisonTier[]): TenantPlanPayload {
  return { planKey: 'free', name: 'FREE', priceCents: 0, price: null, features: [], comparison };
}

/**
 * A host whose FIRST plan read fails when `failFirst`, and answers after:
 * `mockImplementationOnce` over the answering implementation, so no counter
 * is shared across calls.
 */
function host(comparison: ComparisonTier[], failFirst = false): typeof fetch {
  const answer: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/plan') && (init?.method ?? 'GET') === 'GET') {
      return Response.json({ data: { plan: payloadOf(comparison) } });
    }
    return Response.json({ data: { request: { id: 'r1', status: 'open' }, created: true } });
  };
  const fetchImpl = vi.fn(answer);
  if (failFirst) {
    fetchImpl.mockImplementationOnce(async () =>
      Response.json({ error: 'fora do ar' }, { status: 503 }),
    );
  }
  return fetchImpl;
}

function web(fetchImpl: typeof fetch, over: Partial<WebEntitlementsConfig> = {}) {
  return createWebEntitlements({
    apiBase: '/api/admin/acme',
    fetchImpl,
    canRequestPlanChange: true,
    copy: COPY,
    plansPath: '/acme/planos',
    ...over,
  });
}

describe('matrixLayoutFor', () => {
  it('draws the table only where its floors fit the measured frame', () => {
    expect(matrixLayoutFor(null, 5)).toBe('table');
    expect(matrixLayoutFor(426, 3)).toBe('table');
    expect(matrixLayoutFor(425, 3)).toBe('stacked');
    // The 600 px viewport's 490 px frame: three tiers fit; four (514 px) stack.
    expect(matrixLayoutFor(490, 3)).toBe('table');
    expect(matrixLayoutFor(490, 4)).toBe('stacked');
    // The desktop dialog's ~550 px frame holds four; five (602 px) stack.
    expect(matrixLayoutFor(550, 4)).toBe('table');
    expect(matrixLayoutFor(550, 5)).toBe('stacked');
    // A 320 px phone stacks whatever the tier count.
    for (const count of [3, 4, 5]) expect(matrixLayoutFor(262, count)).toBe('stacked');
  });
});

describe('the stacked layout', () => {
  function renderStacked(tiers: ComparisonTier[]) {
    const sections = buildMatrix(selectComparisonRows(tiers, KEYS));
    render(
      <CompareMatrixView
        tiers={tiers}
        sections={sections}
        copy={COPY.comparisonTable}
        badges={{ currentLabel: 'Seu plano', offeredKey: 'max', offeredLabel: 'Recomendado' }}
        width={262}
      />,
    );
  }

  it('gives each label its own line and every tier a cell under it, four tiers included', () => {
    renderStacked(fourTiers());
    expect(screen.getByTestId('plan-compare-stacked')).toBeDefined();
    expect(screen.queryAllByTestId('plan-compare-table')).toHaveLength(0);
    const rows = screen.getAllByTestId('plan-matrix-row');
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    expect(within(first).getByTestId('plan-matrix-label').textContent).toBe('Linha de conversa');
    // One cell per tier, each with its mark and the tier's name.
    for (const name of ['FREE', 'BASIC', 'PRO', 'MAX']) {
      expect(within(first).getByText(name)).toBeDefined();
    }
    expect(within(first).getAllByRole('img')).toHaveLength(4);
  });

  it('words the current and the offered tier as text, in a legend over the columns', () => {
    renderStacked(fourTiers());
    expect(screen.getByTestId('plan-matrix-tier-free').getAttribute('data-current')).toBe('true');
    const current = screen.getByTestId('plan-matrix-current');
    expect(current.textContent).toBe('Seu plano');
    expect(current.parentElement?.textContent).toBe('Seu planoFREE');
    expect(screen.getByTestId('plan-matrix-offered').parentElement?.textContent).toBe('RecomendadoMAX');
  });
});

describe('compareOffer', () => {
  it("offers nothing when the tenant's own tier already covers every row", () => {
    const selected = selectComparisonRows(coveredTiers(), KEYS);
    expect(compareOffer(selected, 3, undefined)).toEqual({ tier: null, covered: true });
  });

  it('otherwise offers the first upgrade, in payload order, that covers every row', () => {
    const selected = selectComparisonRows(fourTiers(), KEYS);
    expect(compareOffer(selected, 3, undefined).tier?.key).toBe('max');
    const twoRows = selectComparisonRows(fourTiers(), ['chat.line', 'chat.assistant']);
    expect(compareOffer(twoRows, 2, null).tier?.key).toBe('pro');
  });
});

describe('the dialog', () => {
  it('is named by its title, and its close button calls onClose', async () => {
    const onClose = vi.fn();
    const { PlanCompare } = web(host(fourTiers()));
    render(<PlanCompare open onClose={onClose} keys={KEYS} />);
    const dialog = await screen.findByRole('dialog', { name: COPY.planCompare.title });
    await within(dialog).findByTestId('plan-compare-table');
    fireEvent.click(within(dialog).getByRole('button', { name: COPY.planCompare.closeLabel }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows four tiers, marks the offered one, and keeps the ask in the footer', async () => {
    const { PlanCompare } = web(host(fourTiers()));
    render(<PlanCompare open onClose={() => undefined} keys={KEYS} />);
    await screen.findByTestId('plan-compare-table');
    for (const key of ['free', 'basic', 'pro', 'max']) {
      expect(screen.getByTestId(`plan-matrix-tier-${key}`)).toBeDefined();
    }
    expect(screen.getByTestId('plan-matrix-offered').textContent).toBe(COPY.planCompare.offeredBadge);
    const footer = screen.getByTestId('plan-compare-footer');
    expect(within(footer).getByTestId('upsell-cta')).toBeDefined();
    expect(within(footer).getByTestId('plan-compare-all-plans')).toBeDefined();
  });

  it("says the tenant's plan already has these, and sells nothing", async () => {
    const { PlanCompare } = web(host(coveredTiers()));
    render(<PlanCompare open onClose={() => undefined} keys={KEYS} />);
    expect((await screen.findByTestId('plan-compare-already-included')).textContent).toBe(
      COPY.planCompare.alreadyIncluded,
    );
    expect(screen.queryAllByTestId('upsell-cta')).toHaveLength(0);
    expect(screen.queryAllByTestId('plan-matrix-offered')).toHaveLength(0);
  });

  it('retries a failed read from the error state', async () => {
    const { PlanCompare } = web(host(fourTiers(), true));
    render(<PlanCompare open onClose={() => undefined} keys={KEYS} />);
    const retry = await screen.findByTestId('plan-compare-error-retry-button');
    expect(retry.textContent).toBe(COPY.planCompare.retry);
    fireEvent.click(retry);
    await screen.findByTestId('plan-compare-table');
    expect(screen.queryAllByTestId('plan-compare-error-retry-button')).toHaveLength(0);
  });

  it('a second raise is a fresh dialog, not the first one\'s "request sent"', async () => {
    const { UpsellHost } = web(host(fourTiers()));
    render(<UpsellHost />);
    act(() => openPlanCompare({ feature: 'chat.assistant', keys: KEYS, plan: 'max' }));
    fireEvent.click(await screen.findByTestId('upsell-cta'));
    await screen.findByTestId('upsell-request-sent');
    act(() => openPlanCompare({ feature: 'chat.line', keys: KEYS, plan: 'pro' }));
    await waitFor(() => expect(screen.getByTestId('upsell-plan-name').textContent).toContain('PRO'));
    expect(screen.getByTestId('upsell-cta')).toBeDefined();
    expect(screen.queryAllByTestId('upsell-request-sent')).toHaveLength(0);
  });
});
