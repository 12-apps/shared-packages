// @vitest-environment jsdom
/**
 * The full matrix — the band the cards gave their rows to.
 *
 * The claims worth pinning are the ones the cards used to violate: a label is
 * stated ONCE across all tiers, a ceiling PRINTS rather than ticking (two
 * identical ✓ marks would hide the only thing the row is about), and the
 * marks — which are a cell's only text — say something out loud.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ComparisonSection, ComparisonTier } from '../../plan-wire';
import { ComparisonTable } from '../comparison-table';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';

const COPY = PT_BR_ENTITLEMENTS_WEB_COPY.comparisonTable;

function tier(name: string, sections: ComparisonSection[], current = false): ComparisonTier {
  return {
    key: name.toLowerCase(),
    name,
    priceCents: 0,
    price: null,
    priceNote: null,
    pitch: '',
    headline: '',
    headlineUnit: '',
    current,
    upgrade: !current,
    recommended: false,
    sections,
  };
}

function hall(): ComparisonTier[] {
  return [
    tier(
      'Ensemble',
      [
        {
          title: 'Repertório',
          lines: [
            { label: 'Partituras', included: true, detail: 'até 25' },
            { label: 'Partes por naipe', included: false, detail: null },
          ],
        },
      ],
      true,
    ),
    tier('Chamber', [
      {
        title: 'Repertório',
        lines: [
          { label: 'Partituras', included: true, detail: 'até 400' },
          { label: 'Partes por naipe', included: true, detail: null },
        ],
      },
    ]),
  ];
}

function open(): void {
  fireEvent.click(screen.getByTestId('plan-compare-toggle'));
}

describe('the comparison table', () => {
  it('is closed until somebody is actually comparing', async () => {
    render(<ComparisonTable tiers={hall()} copy={COPY} />);
    await waitFor(() => expect(screen.queryByTestId('plan-comparison-table')).toBeNull());
    const toggle = screen.getByTestId('plan-compare-toggle');
    expect(toggle.textContent).toContain(COPY.open);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens, and closes again under the same press', async () => {
    render(<ComparisonTable tiers={hall()} copy={COPY} />);
    open();
    expect(screen.getByTestId('plan-comparison-table')).toBeDefined();
    expect(screen.getByTestId('plan-compare-toggle').textContent).toContain(COPY.close);
    open();
    await waitFor(() => expect(screen.queryByTestId('plan-comparison-table')).toBeNull());
  });

  it('states a label once, with one cell per tier', () => {
    render(<ComparisonTable tiers={hall()} copy={COPY} />);
    open();
    // The saving the whole band exists for: two cards said "Partituras"
    // twice; one table says it once.
    expect(screen.getAllByText('Partituras')).toHaveLength(1);
    const row = screen.getByText('Partituras').closest('tr');
    expect(row?.querySelectorAll('td')).toHaveLength(2);
  });

  it('prints a ceiling rather than ticking it', () => {
    render(<ComparisonTable tiers={hall()} copy={COPY} />);
    open();
    const row = screen.getByText('Partituras').closest('tr');
    expect(row?.textContent).toContain('até 25');
    expect(row?.textContent).toContain('até 400');
  });

  it('gives every mark a word, because a cell has no other text', () => {
    render(<ComparisonTable tiers={hall()} copy={COPY} />);
    open();
    const row = screen.getByText('Partes por naipe').closest('tr');
    const marks = row?.querySelectorAll('svg[role="img"]') ?? [];
    expect(marks).toHaveLength(2);
    expect([...marks].map((mark) => mark.getAttribute('aria-label'))).toEqual([
      COPY.excluded,
      COPY.included,
    ]);
  });

  it('heads each tier column with its COMMERCIAL name', () => {
    render(<ComparisonTable tiers={hall()} copy={COPY} />);
    open();
    const headers = [...screen.getByTestId('plan-comparison-table').querySelectorAll('thead th')];
    expect(headers.map((header) => header.textContent)).toEqual([
      COPY.featureColumn,
      'Ensemble',
      'Chamber',
    ]);
  });

  it('renders a hole rather than dropping a row a tier never mentions', () => {
    // The host's builder emits the same rows for every tier; a host whose
    // tiers disagree gets an honest gap instead of a silently shorter table.
    const tiers = [
      tier('Cheap', [{ title: 'A', lines: [] }]),
      tier('Dear', [{ title: 'A', lines: [{ label: 'Camarim', included: true, detail: null }] }]),
    ];
    render(<ComparisonTable tiers={tiers} copy={COPY} />);
    open();
    const row = screen.getByText('Camarim').closest('tr');
    expect(row?.querySelectorAll('svg[aria-label]')).toHaveLength(2);
    expect(row?.querySelector('svg')?.getAttribute('aria-label')).toBe(COPY.excluded);
  });

  it('renders nothing at all where there is nothing to compare', () => {
    const { container } = render(<ComparisonTable tiers={[]} copy={COPY} />);
    expect(container.innerHTML).toBe('');
  });
});
