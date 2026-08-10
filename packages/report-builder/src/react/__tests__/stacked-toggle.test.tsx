// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PresentationSection } from '../builder-sections';
import type { BuilderDraft, ChartKind } from '../builder-model';
import type { ReportField } from '../custom-reports-api';

/**
 * `Empilhado` is refused when there is nothing to stack (FUT-755): "stacked or
 * not, does not make difference", "probably stacked is the same case of line
 * and area".
 *
 * Stacking is a statement about SERIES — bars sat on one another sum to the
 * whole, side by side they are compared. With one series the toggle redraws an
 * identical chart, which is the same defect as a line over a categorical axis:
 * a control claiming to do something it cannot.
 *
 * It is `aria-disabled`, never `disabled`, and that is the half most likely to
 * be got wrong: a genuinely disabled button leaves the tab order and swallows
 * pointer events, so the explanation would sit behind an interaction the very
 * people who need it cannot perform.
 */
const FIELDS: ReportField[] = [
  { field: 'createdAt', label: 'Data', type: 'date', role: 'dimension' },
  { field: 'method', label: 'Forma', type: 'string', role: 'dimension' },
  { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
  { field: 'quantity', label: 'Qtd', type: 'number', role: 'measure' },
];

function draft(patch: Partial<BuilderDraft>): BuilderDraft {
  return {
    name: '',
    description: '',
    entity: 'orders',
    dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
    measures: [{ field: 'revenueCents', aggregation: 'sum' }],
    filters: [],
    sort: [],
    chartType: 'bar',
    stacked: false,
    ...patch,
  };
}

/** Render the section and hand back the patch spy. */
function renderSection(patch: Partial<BuilderDraft>): ReturnType<typeof vi.fn> {
  const update = vi.fn();
  render(<PresentationSection draft={draft(patch)} fields={FIELDS} update={update} />);
  return update;
}

const toggle = (): HTMLElement => screen.getByTestId('builder-chart-stacked');

const SPLIT = [
  { field: 'createdAt', timeGrain: 'day' as const },
  { field: 'method', timeGrain: 'day' as const },
];
const TWO_MEASURES = [
  { field: 'revenueCents', aggregation: 'sum' },
  { field: 'quantity', aggregation: 'sum' },
];

afterEach(cleanup);

describe('Empilhado — when it does something', () => {
  it('is enabled once a SPLIT provides the series', () => {
    renderSection({ dimensions: SPLIT });
    expect(toggle().getAttribute('aria-disabled')).toBeNull();
  });

  it('is enabled once a SECOND MEASURE provides them', () => {
    renderSection({ measures: TWO_MEASURES });
    expect(toggle().getAttribute('aria-disabled')).toBeNull();
  });

  it('toggles the draft when it is enabled', () => {
    const update = renderSection({ dimensions: SPLIT });
    fireEvent.click(toggle());
    expect(update).toHaveBeenCalledWith({ stacked: true });
  });
});

describe('Empilhado — when there is nothing to stack', () => {
  it('is aria-disabled rather than disabled, so it keeps focus and pointer events', () => {
    renderSection({});
    expect(toggle().getAttribute('aria-disabled')).toBe('true');
    // A real `disabled` would put the reason behind an interaction the people
    // who need it cannot perform.
    expect(toggle().hasAttribute('disabled')).toBe(false);
  });

  it('carries the reason as its accessible description with no event at all', () => {
    renderSection({});
    const reason = toggle().getAttribute('title') ?? '';
    // Names the control to change and quotes it, like every other reason in
    // this area — not a bare "indisponível".
    expect(reason).toContain('“separar em séries”');
    expect(reason).toContain('medida');
  });

  it('shows the reason on hover', async () => {
    renderSection({});
    fireEvent.mouseEnter(toggle());
    await waitFor(() => {
      expect(screen.getByTestId('builder-chart-stacked-reason')).toBeTruthy();
    });
  });

  it('shows the reason on keyboard focus, not only on hover', async () => {
    renderSection({});
    // `focusIn`, the event React's onFocus delegation actually listens for —
    // and, unlike a bare `.focus()`, dispatched inside `act`.
    fireEvent.focusIn(toggle());
    await waitFor(() => {
      expect(screen.getByTestId('builder-chart-stacked-reason')).toBeTruthy();
    });
  });

  it('explains itself instead of toggling when clicked', async () => {
    const update = renderSection({});
    fireEvent.click(toggle());
    await waitFor(() => {
      expect(screen.getByTestId('builder-chart-stacked-reason')).toBeTruthy();
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('Empilhado — where it is not offered at all', () => {
  it.each(['line', 'pie', 'donut', 'table', 'kpi'] as const)(
    'renders no toggle for %s',
    (chartType: ChartKind) => {
      // Not a refused toggle — no toggle. A pie has no stacking to offer.
      renderSection({ chartType, dimensions: SPLIT });
      // `queryAll…` + `toEqual([])`: the failure message then names what it
      // found instead of saying "not null".
      expect(screen.queryAllByTestId('builder-chart-stacked')).toEqual([]);
    },
  );
});
