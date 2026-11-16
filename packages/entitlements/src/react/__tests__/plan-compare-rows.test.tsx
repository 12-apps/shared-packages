// @vitest-environment jsdom
/**
 * The reusable plan comparison (FUT-3921): a screen words its OWN title and
 * rows (a key may repeat), and with `offer: 'each'` the footer offers one
 * "Conhecer o <plano>" per upgrade plan on sale. "Seu plano" comes from the
 * payload's own tier, on sale or not.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ComparisonLine, ComparisonTier, TenantPlanPayload } from '../../plan-wire';
import { buildRowsMatrix } from '../comparison-rows';
import { createWebEntitlements } from '../create-web-entitlements';
import { EN_US_ENTITLEMENTS_WEB_COPY } from '../en-US';
import { openPlanCompare, type PlanCompareProps } from '../plan-compare-dialog';
import { planPathAt } from '../plan-compare-each';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import type { WebEntitlementsConfig } from '../web-config';

const rowsOf = (): { key: string; label: string }[] => [
  { key: 'win.list', label: 'Lista com WhatsApp' },
  { key: 'win.email', label: 'E-mail de volta' },
  { key: 'win.email', label: 'Crédito na carteira' },
  { key: 'win.email', label: 'Enviar para todos com um toque' },
  { key: 'win.auto', label: 'Envio automático todo dia' },
  { key: 'win.auto', label: 'Teto de crédito por mês' },
];

function lines(list: boolean, email: boolean, auto: boolean): ComparisonLine[] {
  return [
    { key: 'win.list', label: 'catalogue list', included: list, detail: null },
    { key: 'win.email', label: 'catalogue email', included: email, detail: null },
    { key: 'win.auto', label: 'catalogue auto', included: auto, detail: null },
  ];
}

function tier(
  key: string,
  name: string,
  flags: [boolean, boolean, boolean],
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
      { title: 'Clientes', lines: lines(...flags) },
      { title: 'Outros', lines: [{ key: 'other', label: 'Outro', included: true, detail: null }] },
    ],
    ...over,
  };
}

const FREE = tier('free', 'Grátis', [true, false, false], { current: true, upgrade: false });
const PRO = tier('pro', 'Pro', [true, true, false]);
const MAX = tier('max', 'Max', [true, true, true]);

function mount(
  comparison: ComparisonTier[],
  props: Partial<PlanCompareProps> = {},
  over: Partial<WebEntitlementsConfig> = {},
) {
  const payload: TenantPlanPayload = {
    planKey: 'free',
    name: 'Grátis',
    priceCents: 0,
    price: null,
    features: [],
    comparison,
  };
  const fetchImpl: typeof fetch = async () => Response.json({ data: { plan: payload } });
  const { PlanCompare, UpsellHost } = createWebEntitlements({
    apiBase: '/api/admin/acme',
    fetchImpl,
    canRequestPlanChange: true,
    copy: PT_BR_ENTITLEMENTS_WEB_COPY,
    plansPath: '/acme/planos',
    ...over,
  });
  render(<PlanCompare open onClose={() => undefined} rows={rowsOf()} {...props} />);
  return { UpsellHost };
}

function labels(): string[] {
  return screen
    .getAllByTestId('plan-matrix-row')
    .map((row) => row.querySelector('th')?.textContent ?? '');
}

describe('title', () => {
  it("shows the screen's own title", async () => {
    mount([FREE, MAX], { title: 'Clientes sumidos' });
    const modal = await screen.findByTestId('plan-compare-modal');
    expect(within(modal).getByText('Clientes sumidos')).toBeDefined();
    expect(within(modal).queryAllByText(PT_BR_ENTITLEMENTS_WEB_COPY.planCompare.title)).toHaveLength(0);
  });

  it('keeps the pack title when none, or only blanks, is given', async () => {
    mount([FREE, MAX], { title: '  ' });
    const modal = await screen.findByTestId('plan-compare-modal');
    expect(within(modal).getByText(PT_BR_ENTITLEMENTS_WEB_COPY.planCompare.title)).toBeDefined();
  });
});

describe('the screen\'s own rows', () => {
  it('draws one row per request in the screen order, a key repeating', async () => {
    mount([FREE, MAX]);
    await screen.findByTestId('plan-matrix-tier-max');
    expect(labels()).toEqual(rowsOf().map((row) => row.label));
  });

  it('marks each cell from the tier line its key names', () => {
    const [section] = buildRowsMatrix([FREE, PRO, MAX], rowsOf());
    const included = (index: number, tierKey: string): boolean | undefined =>
      section?.rows[index]?.cells.get(tierKey)?.included;
    expect(section?.title).toBe('');
    // free: list only. pro: list and the three e-mail rows. max: all six.
    expect([0, 1, 2, 3, 4, 5].map((i) => included(i, 'free'))).toEqual([true, false, false, false, false, false]);
    expect([0, 1, 2, 3, 4, 5].map((i) => included(i, 'pro'))).toEqual([true, true, true, true, false, false]);
    expect([0, 1, 2, 3, 4, 5].map((i) => included(i, 'max'))).toEqual([true, true, true, true, true, true]);
  });

  it('leaves out a row whose key no tier carries, and a payload line the screen never named', async () => {
    mount([FREE, MAX], { rows: [...rowsOf(), { key: 'nobody.has.this', label: 'Fantasma' }] });
    await screen.findByTestId('plan-matrix-tier-max');
    expect(labels()).not.toContain('Fantasma');
    expect(screen.queryAllByText('Outro')).toHaveLength(0);
  });

  it('says so when no row matches', async () => {
    mount([FREE, MAX], { rows: [{ key: 'nope', label: 'Nada' }] });
    await screen.findByTestId('plan-compare-empty');
  });

  it('still honours `keys` for a caller that names none', async () => {
    mount([FREE, MAX], { rows: undefined, keys: ['win.list'] });
    await screen.findByTestId('plan-matrix-tier-max');
    expect(labels()).toEqual(['catalogue list']);
  });
});

describe('"Seu plano"', () => {
  it("marks the payload's own tier, even one that is not on sale any more", async () => {
    const legacy = tier('legacy', 'Antigo', [true, false, false], { current: true, upgrade: false });
    mount([legacy, MAX], { offer: 'each' });
    const own = await screen.findByTestId('plan-matrix-tier-legacy');
    expect(own.getAttribute('data-current')).toBe('true');
    expect(within(own).getByTestId('plan-matrix-current').textContent).toBe('Seu plano');
    // The legacy plan is a column to read, never an action to take.
    expect(screen.queryAllByTestId('plan-compare-learn-legacy')).toHaveLength(0);
    expect(screen.getByTestId('plan-compare-learn-max')).toBeDefined();
  });
});

describe('offer: "each"', () => {
  it('offers the one plan on sale as a link to the plans page at that tier', async () => {
    mount([FREE, MAX], { offer: 'each' });
    const learn = await screen.findByTestId('plan-compare-learn-max');
    expect(learn.textContent).toBe('Conhecer o Max');
    expect(learn.getAttribute('href')).toBe('/acme/planos?plan=max');
    expect(screen.queryAllByTestId('upsell-cta')).toHaveLength(0);
    // No single recommendation badge over a column: the actions name the plans.
    expect(screen.queryAllByTestId('plan-matrix-offered')).toHaveLength(0);
  });

  it('offers every upgrade plan on sale, none for the own plan, solid for the last', async () => {
    mount([FREE, PRO, MAX], { offer: 'each' });
    await screen.findByTestId('plan-compare-learn-pro');
    expect(screen.getByTestId('plan-compare-learn-max').getAttribute('href')).toBe('/acme/planos?plan=max');
    expect(screen.queryAllByTestId('plan-compare-learn-free')).toHaveLength(0);
    const [pro, max] = [
      screen.getByTestId('plan-compare-learn-pro'),
      screen.getByTestId('plan-compare-learn-max'),
    ];
    expect(pro.className).not.toBe(max.className);
    // In plan order, on ONE grid row (ADR 0190).
    expect(pro.parentElement).toBe(max.parentElement);
    expect(pro.compareDocumentPosition(max) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the flagged recommended plan is the solid one', async () => {
    mount([FREE, PRO, MAX], { offer: 'each' });
    const outline = (await screen.findByTestId('plan-compare-learn-pro')).className;
    const solid = screen.getByTestId('plan-compare-learn-max').className;
    cleanup();
    const flagged = tier('pro', 'Pro', [true, true, false], { recommended: true });
    mount([FREE, flagged, MAX], { offer: 'each' });
    expect((await screen.findByTestId('plan-compare-learn-pro')).className).toBe(solid);
    expect(screen.getByTestId('plan-compare-learn-max').className).toBe(outline);
  });

  it('closes the dialog when a plan is chosen', async () => {
    const onClose = vi.fn();
    mount([FREE, MAX], { offer: 'each', onClose });
    const learn = await screen.findByTestId('plan-compare-learn-max');
    learn.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(learn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers nothing when the own plan already includes every row', async () => {
    const full = tier('max', 'Max', [true, true, true], { current: true, upgrade: false });
    mount([full], { offer: 'each' });
    await screen.findByTestId('plan-compare-already-included');
    expect(screen.queryAllByTestId('plan-compare-each')).toHaveLength(0);
  });

  it('with no plan on sale, falls back to the all-plans link', async () => {
    mount([FREE], { offer: 'each' });
    await screen.findByTestId('plan-compare-all-plans');
    expect(screen.queryAllByTestId('plan-compare-each')).toHaveLength(0);
  });

  it('without a plans page, falls back to the one ask for the cheapest plan', async () => {
    mount([FREE, PRO, MAX], { offer: 'each' }, { plansPath: undefined });
    await waitFor(() => expect(screen.getByTestId('upsell-plan-name').textContent).toContain('Max'));
    expect(screen.queryAllByTestId('plan-compare-each')).toHaveLength(0);
  });

  it('is still the single ask by default', async () => {
    mount([FREE, PRO, MAX]);
    await screen.findByTestId('upsell-cta');
    expect(screen.queryAllByTestId('plan-compare-each')).toHaveLength(0);
  });
});

describe('planPathAt', () => {
  it('appends the tier, keeping a query the path already has', () => {
    expect(planPathAt('/acme/planos', 'max')).toBe('/acme/planos?plan=max');
    expect(planPathAt('/acme/planos?x=1', 'a b')).toBe('/acme/planos?x=1&plan=a%20b');
  });
});

describe('opening it from anywhere', () => {
  it('openPlanCompare carries title, rows and offer through the upsell host', async () => {
    const { UpsellHost } = mount([FREE, MAX], { open: false });
    render(<UpsellHost />);
    act(() => {
      openPlanCompare({
        feature: 'win.email',
        title: 'Clientes sumidos',
        rows: rowsOf(),
        offer: 'each',
      });
    });
    const modal = await screen.findByTestId('plan-compare-modal');
    expect(within(modal).getByText('Clientes sumidos')).toBeDefined();
    await screen.findByTestId('plan-compare-learn-max');
    expect(labels()).toEqual(rowsOf().map((row) => row.label));
  });
});

describe('keyboard and focus', () => {
  it('reaches each plan action in order by Tab, and Escape closes', async () => {
    const onClose = vi.fn();
    mount([FREE, PRO, MAX], { offer: 'each', onClose });
    const pro = await screen.findByTestId('plan-compare-learn-pro');
    const max = screen.getByTestId('plan-compare-learn-max');
    // Real anchors with an href: focusable and activatable with no extra role.
    expect(pro.tagName).toBe('A');
    expect(pro.getAttribute('role')).toBeNull();
    // Reachable by Tab: anchors with an href, in plan order.
    expect(pro.getAttribute('href')).not.toBeNull();
    expect(max.hasAttribute('href')).toBe(true);
    expect(pro.compareDocumentPosition(max) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('plan-compare-modal'), { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('a host copy written before learnPlan existed', () => {
  it('words the action from the en-US pack', async () => {
    const legacy = {
      ...PT_BR_ENTITLEMENTS_WEB_COPY,
      planCompare: { ...PT_BR_ENTITLEMENTS_WEB_COPY.planCompare, learnPlan: undefined },
    };
    mount([FREE, MAX], { offer: 'each' }, { copy: legacy });
    const learn = await screen.findByTestId('plan-compare-learn-max');
    expect(learn.textContent).toBe(EN_US_ENTITLEMENTS_WEB_COPY.planCompare.learnPlan?.({ planName: 'Max' }));
  });
});
