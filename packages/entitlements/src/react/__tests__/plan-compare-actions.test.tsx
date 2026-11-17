// @vitest-environment jsdom
/**
 * The plan comparison's per-plan actions and the screen's own words around the
 * table (FUT-3921, review round 1): the link adapter's contract (every prop and
 * the ref reach the anchor, so the button's look and its keyboard focus ring
 * survive), one row or one whole row each, no action without compared rows, and
 * the optional subtitle, footnote and illustration.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';

import type { ComparisonTier, TenantPlanPayload } from '../../plan-wire';
import { createWebEntitlements } from '../create-web-entitlements';
import { openPlanCompare, type PlanCompareProps } from '../plan-compare-dialog';
import { fitsOneRow } from '../plan-compare-each';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import type { EntitlementsLinkProps, WebEntitlementsConfig } from '../web-config';

function tier(key: string, name: string, over: Partial<ComparisonTier> = {}): ComparisonTier {
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
        title: 'Reports',
        lines: [{ key: 'reports.export', label: 'Export', included: key !== 'free', detail: null }],
      },
    ],
    ...over,
  };
}

const rowsOf = (): { key: string; label: string }[] => [
  { key: 'reports.export', label: 'Exportar relatórios' },
];

/** An adapter that keeps every prop and the ref, as the docs require. */
function SpreadingLink({ to, children, ...rest }: EntitlementsLinkProps): JSX.Element {
  return (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}

function mount(
  comparison: ComparisonTier[],
  props: Partial<PlanCompareProps> = {},
  over: Partial<WebEntitlementsConfig> = {},
) {
  const payload: TenantPlanPayload = {
    planKey: 'free',
    name: 'Free',
    priceCents: 0,
    price: null,
    features: [],
    comparison,
  };
  const fetchImpl: typeof fetch = async () => Response.json({ data: { plan: payload } });
  const web = createWebEntitlements({
    apiBase: '/api/admin/acme',
    fetchImpl,
    canRequestPlanChange: true,
    copy: PT_BR_ENTITLEMENTS_WEB_COPY,
    plansPath: '/acme/planos',
    ...over,
  });
  render(<web.PlanCompare open onClose={() => undefined} rows={rowsOf()} offer="each" {...props} />);
  return web;
}

const FREE = tier('free', 'Free', { current: true, upgrade: false });
const MAX = tier('max', 'Max');

describe('the link adapter contract', () => {
  it.each([
    ['the package default anchor', {}],
    ['an adapter that spreads every prop', { LinkComponent: SpreadingLink }],
  ])('%s: a keyboard-focused action shows the button focus state', async (_name, over) => {
    mount([FREE, MAX], {}, over);
    const link = await screen.findByTestId('plan-compare-learn-max');
    fireEvent.keyDown(document, { key: 'Tab' });
    // The keyboard moves real focus; `fireEvent.focus` would not set :focus-visible.
    act(() => HTMLElement.prototype.focus.call(link));
    await waitFor(() => expect(link.className).toContain('Mui-focusVisible'));
  });

  it('the default anchor keeps the button class, so it is painted as one', async () => {
    mount([FREE, MAX]);
    const anchor = await screen.findByTestId('plan-compare-learn-max');
    expect(anchor.className).toContain('MuiButton');
    expect(anchor.getAttribute('aria-label')).toBe('Conhecer o Max');
  });
});

describe('one row, or one whole row each', () => {
  it('fits side by side only while the longest label fits one line in a column', () => {
    const base = { gap: 8, count: 2, buttonPadding: 24 };
    // 2 x (100 + 24) + 8 = 256
    expect(fitsOneRow({ ...base, width: 256, longestLabel: 100 })).toBe(true);
    expect(fitsOneRow({ ...base, width: 255, longestLabel: 100 })).toBe(false);
    // The longest label decides, not the average: columns are equal.
    expect(fitsOneRow({ ...base, width: 256, longestLabel: 130 })).toBe(false);
    expect(fitsOneRow({ ...base, width: 0, longestLabel: 500 })).toBe(true);
    expect(fitsOneRow({ ...base, count: 1, width: 124, longestLabel: 100 })).toBe(true);
  });

  it('draws the row layout where nothing can be measured', async () => {
    mount([FREE, tier('pro', 'Pro'), MAX]);
    await screen.findByTestId('plan-compare-learn-max');
    expect(screen.getByTestId('plan-compare-each').firstElementChild?.getAttribute('data-layout')).toBe(
      'row',
    );
  });
});

describe('with no compared row', () => {
  it('offers no plan to look at: the all-plans link says where to go', async () => {
    mount([FREE, MAX], { rows: [{ key: 'nobody.has.this', label: 'Ghost' }] });
    await screen.findByTestId('plan-compare-empty');
    expect(screen.queryAllByTestId('plan-compare-learn-max')).toHaveLength(0);
    expect(screen.getByTestId('plan-compare-all-plans')).toBeDefined();
  });
});

describe("the screen's own words around the table", () => {
  it('draws the subtitle and illustration above the table and the footnote under it', async () => {
    mount([FREE, MAX], {
      subtitle: 'What each plan does here.',
      footnote: 'Only plans on sale today.',
      illustration: <svg data-testid="art" />,
    });
    const table = await screen.findByTestId('plan-compare');
    const intro = screen.getByTestId('plan-compare-intro');
    expect(screen.getByTestId('plan-compare-subtitle').textContent).toBe('What each plan does here.');
    expect(screen.getByTestId('plan-compare-illustration').querySelector('[data-testid="art"]')).not.toBeNull();
    const footnote = screen.getByTestId('plan-compare-footnote');
    expect(footnote.textContent).toBe('Only plans on sale today.');
    expect(intro.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(footnote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws none of them by default', async () => {
    mount([FREE, MAX]);
    await screen.findByTestId('plan-compare');
    expect(screen.queryAllByTestId('plan-compare-intro')).toHaveLength(0);
    expect(screen.queryAllByTestId('plan-compare-footnote')).toHaveLength(0);
  });

  it('carries all three through openPlanCompare and the prompt host', async () => {
    const { UpsellHost } = mount([FREE, MAX], { open: false });
    render(<UpsellHost />);
    act(() => {
      openPlanCompare({
        feature: 'reports.export',
        rows: rowsOf(),
        subtitle: 'Sub',
        footnote: 'Note',
        illustration: <svg data-testid="art" />,
        offer: 'each',
      });
    });
    await screen.findByTestId('plan-compare-learn-max');
    expect(screen.getByTestId('plan-compare-subtitle').textContent).toBe('Sub');
    expect(screen.getByTestId('plan-compare-footnote').textContent).toBe('Note');
    expect(screen.getByTestId('art')).toBeDefined();
  });
});

describe('the request names its rows', () => {
  it('requires keys or rows at the call a screen writes', () => {
    // @ts-expect-error neither `keys` nor `rows`: nothing to compare
    const missing: Parameters<typeof openPlanCompare>[0] = { feature: 'reports.export' };
    expect(missing.feature).toBe('reports.export');
  });
});
