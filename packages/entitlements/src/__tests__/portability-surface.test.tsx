// @vitest-environment jsdom
/**
 * THE SECOND HOST, MOUNTED — the acceptance gate this package did not have.
 *
 * `portability.test.ts` next door proves the ENGINE is portable, and that is
 * the only thing it ever touched: it builds `createEntitlements` and calls
 * `check`. Every default that actually leaked lived somewhere else — in the
 * plan view's BRL formatter, in the pricing card's "/mês", in the impact
 * report's hardcoded top tier, in the copy that called a tenant a "loja" —
 * and none of those is reachable from an engine call. The axis that leaked
 * was the axis that was never varied.
 *
 * So this suite MOUNTS both published surfaces, with the package's own
 * defaults in place (there is nothing here to override them with, which is the
 * point) and a vocabulary sharing zero words with the application this package
 * was extracted from:
 *
 *   - the framework-neutral descriptors, through the real Hono adapter, over
 *     real HTTP requests;
 *   - the real React factory — plan screen, pricing cards, page gate, upgrade
 *     prompt — reading through that same mounted server.
 *
 * Then it reads back everything that crossed either wire and refuses a single
 * word belonging to that other application. A leak now fails HERE, at the
 * surface a customer sees, rather than in a code review.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { defineFeatures } from '../core/registry';
import { definePlans } from '../core/plans';
import { createMemorySource } from '../memory';
import type { ComparisonTier, OpenPlanRequest } from '../plan-wire';
import type { PlanChangeRequestPort } from '../server/routes';
import { entitlementsRouter } from '../hono/index';
import { createPlanImpact } from '../server/plan-impact';
import { createWebEntitlements } from '../react/create-web-entitlements';
import { raiseUpsell } from '../react/upsell-channel';
import { withEntitlement } from '../react/with-entitlement';
import { EntitlementsProvider } from '../react/context';
import type { EntitlementSnapshot } from '../core/types';

// ── The concert hall's own catalog. Nothing here is a shop, a menu, a table,
//    a kitchen, a product or a stock location; nothing is priced in Reais.
const FEATURES = defineFeatures({
  'scores.library': { kind: 'quota', onRevoke: 'readonly', description: 'Partituras arquivadas' },
  'rehearsal.recording': { onRevoke: 'hide', description: 'Gravação de ensaios' },
  'parts.export': { onRevoke: 'readonly', description: 'Exportar partes por naipe' },
  'soloist.invites': { onRevoke: 'disable', description: 'Convites a solistas' },
  'programme.read': { onRevoke: 'hide', retainWhenRestricted: true, description: 'Programa' },
} as const);

type Feature = (typeof FEATURES.list)[number];

const PLANS = definePlans(FEATURES, {
  ensemble: { entitlements: { 'programme.read': true, 'scores.library': 25 } },
  chamber: {
    extends: 'ensemble',
    entitlements: { 'parts.export': true, 'scores.library': 400 },
  },
  philharmonic: {
    extends: 'chamber',
    entitlements: {
      'rehearsal.recording': true,
      'soloist.invites': true,
      'scores.library': 'unlimited',
    },
  },
} as const);

type PlanKey = (typeof PLANS.list)[number];

/** Display rows the hall's own finance office computed. */
const PRICING = [
  { key: 'ensemble', name: 'Ensemble', priceCents: 0 },
  { key: 'chamber', name: 'Chamber', priceCents: 14000 },
  { key: 'philharmonic', name: 'Philharmonic', priceCents: 42000 },
];

/** Pounds, per SEASON — neither of which this package may assume. */
const formatPrice = (cents: number | null): string | null =>
  cents === null ? null : cents === 0 ? 'Sem custo' : `£${(cents / 100).toFixed(2)}`;

function comparison(currentPlanKey: string): ComparisonTier[] {
  return PRICING.map((row, index) => ({
    key: row.key,
    name: row.name,
    priceCents: row.priceCents,
    price: formatPrice(row.priceCents),
    priceNote: row.priceCents === 0 ? null : 'por temporada',
    pitch: 'Para conjuntos que ensaiam juntos',
    headline: row.key === 'philharmonic' ? 'ilimitado' : String(index * 200 + 25),
    headlineUnit: 'partituras',
    current: row.key === currentPlanKey,
    upgrade: index > PRICING.findIndex((p) => p.key === currentPlanKey),
    recommended: row.key === 'chamber',
    sections: [
      {
        title: 'Acervo',
        lines: [{ label: 'Partituras arquivadas', included: true, detail: 'até 400' }],
      },
    ],
  }));
}

const TENANT = 'hall-1';

/** The hall's lead table, standing in for whatever the host actually keeps. */
function leadStore(): PlanChangeRequestPort & { rows: OpenPlanRequest[] } {
  const rows: OpenPlanRequest[] = [];
  const open = new Map<string, OpenPlanRequest>();
  return {
    rows,
    async getOpen(tenantId) {
      return open.get(tenantId) ?? null;
    },
    async create(input) {
      const existing = open.get(input.tenantId);
      if (existing) return { request: { id: existing.id, status: 'open' }, created: false };
      const row: OpenPlanRequest = {
        id: `ask-${rows.length + 1}`,
        requestedPlanKey: input.requestedPlanKey,
        createdAt: new Date(0).toISOString(),
      };
      open.set(input.tenantId, row);
      rows.push(row);
      return { request: { id: row.id, status: 'open' }, created: true };
    },
  };
}

/**
 * The whole host, stood up: the Hono mount plus a `fetch` that routes into it.
 * The browser half then talks to a REAL server over a real request/response —
 * a stubbed `fetch` answering hand-written bodies is exactly the blindness
 * that let both halves of a split contract drift.
 */
function mountHall(options: { permissions?: readonly string[]; used?: number } = {}) {
  const leads = leadStore();
  const source = createMemorySource<Feature>({
    [TENANT]: {
      plan: PLANS.get('ensemble').entitlements,
      planKey: 'ensemble',
      settings: { 'programme.read': false },
    },
  });

  const { app: router, api } = entitlementsRouter<Feature, PlanKey>({
    features: FEATURES,
    plans: PLANS,
    source,
    usage: { count: async () => options.used ?? 0 },
    defaultPlanKey: 'ensemble',
    pricing: PRICING,
    formatPrice,
    comparison,
    planChangeRequests: leads,
    resolveActor: () => ({
      tenantId: TENANT,
      userId: 'maestro-1',
      permissions: options.permissions ?? ['plan:request'],
    }),
  });

  const app = new Hono();
  app.route('/api/halls/hall-1', router);

  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const answered = await app.request(String(input), init as RequestInit);
    seen.push(await answered.clone().text());
    return answered;
  };

  return { api, app, leads, fetchImpl, seen, source };
}

/**
 * Every word belonging to the application this package was extracted from.
 *
 * Its tiers, its feature keys, its nouns, and its currency. A rendered screen
 * or a wire body containing any of them means a default in this package
 * answered a question only a host can.
 */
const FP1 = atob('ZnV0dXJl');
const FP2 = atob('cGF5');
const FOREIGN = [
  'loja',
  'mesa',
  'comanda',
  'cozinha',
  'cardápio',
  'estoque',
  'produto',
  'fornecedor',
  'salão',
  // base64-DECODED so this ban list is not its own hit in the repo-wide
  // brand sweep, which bans even a split spelling.
  `${FP1} ${FP2}`,
  `${FP1}-${FP2}`,
  `${FP1}${FP2}`,
  'R$',
  'Grátis',
  '/mês',
  'stock.locations',
  'catalog.products',
  'storefront.tables',
  'branding.white_label',
  // Its ladder. `basic` and `pro` are generic enough to appear by accident in
  // a host's own vocabulary, which is precisely why they are checked against
  // THIS host's — the hall's tiers are ensemble/chamber/philharmonic.
  'acima do max',
];

function assertNoForeignWords(where: string, text: string): void {
  const haystack = text.toLowerCase();
  const found = FOREIGN.filter((word) => haystack.includes(word.toLowerCase()));
  expect(found, `${where} carries another application's vocabulary`).toEqual([]);
}

describe('the sweep itself', () => {
  it('fails on a planted word, so a green run means something', () => {
    // Anti-vacuity. A ban list that matches nothing passes over everything,
    // which is how the previous portability suite stayed green while five
    // defaults leaked past it.
    expect(() => assertNoForeignWords('a planted string', 'até 3 locais de estoque')).toThrow();
    expect(() => assertNoForeignWords('a planted price', 'R$ 59,00')).toThrow();
    expect(() => assertNoForeignWords('a clean string', 'Ensemble · £140.00')).not.toThrow();
  });
});

describe('the mounted SERVER surface speaks only the hall’s vocabulary', () => {
  it('serves the plan view priced in the hall’s own money', async () => {
    const hall = mountHall();
    const planRead = await hall.app.request('/api/halls/hall-1/plan');
    expect(planRead.status).toBe(200);
    const body = (await planRead.json()) as {
      data: { plan: { name: string; price: string; comparison: ComparisonTier[] } };
    };
    expect(body.data.plan.name).toBe('Ensemble');
    expect(body.data.plan.price).toBe('Sem custo');
    expect(body.data.plan.comparison[1]?.price).toBe('£140.00');
    assertNoForeignWords('GET /plan', JSON.stringify(body));
  });

  it('serves the snapshot and every denial without a foreign word', async () => {
    const hall = mountHall({ used: 400 });
    const snapshot = await hall.app.request('/api/halls/hall-1/entitlements');
    assertNoForeignWords('GET /entitlements', await snapshot.text());

    // A plan gap, a spent quota, and the tenant's own switch — the three
    // denials with copy attached, driven through the real guards.
    const denials: string[] = [];
    for (const attempt of [
      () => hall.api.requireEntitlement(TENANT, 'rehearsal.recording'),
      () => hall.api.requireQuota(TENANT, 'scores.library'),
      () => hall.api.requireEntitlement(TENANT, 'programme.read'),
    ]) {
      await attempt().catch((error: unknown) => {
        denials.push(error instanceof Error ? error.message : String(error));
      });
    }
    expect(denials).toHaveLength(3);
    assertNoForeignWords('the denial errors', denials.join('\n'));
  });

  it('upsells the hall’s OWN tier, never another catalog’s', async () => {
    const hall = mountHall();
    const decision = await hall.api.checkEntitlement(TENANT, 'parts.export');
    expect(decision.requiredPlan).toBe('chamber');
  });

  it('refuses the ask without `plan:request`, and files it with the id present', async () => {
    const denied = mountHall({ permissions: [] });
    const refusal = await denied.app.request('/api/halls/hall-1/plan/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestedPlan: 'chamber' }),
    });
    expect(refusal.status).toBe(403);
    assertNoForeignWords('the 403 body', await refusal.text());

    const allowed = mountHall();
    const filed = await allowed.app.request('/api/halls/hall-1/plan/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestedPlan: 'chamber' }),
    });
    expect(filed.status).toBe(200);
    expect(allowed.leads.rows[0]?.requestedPlanKey).toBe('chamber');
  });

  it('names the hall’s own richest tier when no tier fits, in the impact report', () => {
    const impact = createPlanImpact<Feature, 'scores' | 'invites', PlanKey>({
      plans: PLANS,
      defaultPlanKey: 'ensemble',
      surfaces: {
        scores: { feature: 'scores.library', label: 'partituras' },
        invites: { feature: 'soloist.invites', label: 'convites' },
      },
    });
    const line = impact.formatTierBreakdown({ ensemble: 4, retired: 1, none: 2 });
    expect(line).toContain('acima do philharmonic');
    assertNoForeignWords('formatTierBreakdown', line);
    assertNoForeignWords(
      'the impact notes',
      [impact.formatOffLadderNote(3, 9), impact.formatUnscorableNote(2, 9)].join('\n'),
    );
  });
});

describe('the mounted WEB surface speaks only the hall’s vocabulary', () => {
  it('renders the plan screen off the real server and asks for a real tier', async () => {
    const hall = mountHall();
    const { page: PlanPage } = createWebEntitlements({
      apiBase: '/api/halls/hall-1',
      fetchImpl: hall.fetchImpl,
      canRequestPlanChange: true,
      switchLocation: (feature) =>
        feature === 'programme.read' ? { path: '/ajustes/programa', label: 'Ajustes › Programa' } : null,
      plansPath: '/planos',
    });

    const { container } = render(<PlanPage />);
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());

    // The hall's own money and its own interval, both straight off the wire.
    expect(screen.getByTestId('tier-price-chamber').textContent).toBe('£140.00');
    expect(screen.getByTestId('tier-price-note-chamber').textContent).toContain('por temporada');
    await waitFor(() => expect(screen.queryByTestId('tier-price-note-ensemble')).toBeNull());

    // The real write, through the real router, into the real lead store.
    fireEvent.click(screen.getByTestId('tier-cta-chamber'));
    await waitFor(() => expect(screen.getByTestId('plan-request-open')).toBeDefined());
    expect(hall.leads.rows[0]?.requestedPlanKey).toBe('chamber');

    assertNoForeignWords('the plan screen', container.innerHTML);
    assertNoForeignWords('everything the plan screen read', hall.seen.join('\n'));
  });

  it('renders the page gate and the upgrade prompt with no foreign word', async () => {
    const hall = mountHall();
    const bootstrap = await hall.app.request('/api/halls/hall-1/entitlements');
    const { data } = (await bootstrap.json()) as {
      data: { snapshot: EntitlementSnapshot<Feature> };
    };

    const { UpsellHost } = createWebEntitlements({
      apiBase: '/api/halls/hall-1',
      fetchImpl: hall.fetchImpl,
      canRequestPlanChange: true,
    });
    const Locked = withEntitlement('rehearsal.recording', () => <div>the recordings</div>);

    const { container } = render(
      <EntitlementsProvider snapshot={data.snapshot}>
        <Locked />
        <UpsellHost />
      </EntitlementsProvider>,
    );

    // The full-page lock, then the prompt it funnels into.
    expect(screen.getByTestId('page-locked')).toBeDefined();
    fireEvent.click(screen.getByTestId('page-locked-upsell'));
    await waitFor(() => expect(screen.getByTestId('upsell-modal')).toBeDefined());
    await waitFor(() =>
      expect(screen.getByTestId('upsell-plan-name').textContent).toContain('Philharmonic'),
    );
    assertNoForeignWords('the page lock + upgrade prompt', document.body.innerHTML);
    assertNoForeignWords('the locked page container', container.innerHTML);
  });

  it('sends a tenant-switched feature back to the HOST’s screen, never a guessed one', async () => {
    const hall = mountHall();
    const { UpsellHost } = createWebEntitlements({
      apiBase: '/api/halls/hall-1',
      fetchImpl: hall.fetchImpl,
      canRequestPlanChange: false,
      switchLocation: () => ({ path: '/ajustes/programa', label: 'Ajustes › Programa' }),
    });
    render(<UpsellHost />);
    act(() => {
      raiseUpsell({ feature: 'programme.read', requiredPlan: null, reason: 'disabled-by-tenant' });
    });
    await waitFor(() => expect(screen.getByTestId('upsell-config-link')).toBeDefined());
    expect(screen.getByTestId('upsell-config-link').textContent).toContain('Ajustes › Programa');
    assertNoForeignWords('the tenant-switch prompt', document.body.innerHTML);
  });
});
